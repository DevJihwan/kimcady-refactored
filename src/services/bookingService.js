// services/bookingService.js
const { parseMultipartFormData } = require('../utils/parser');
const { handleBookingListingResponse, handleBookingCreateResponse, processPendingBookingUpdates } = require('../handlers/response-helpers');
const { getAccessToken, convertKSTtoUTC } = require('../utils/api');
const { createBooking, cancelBooking } = require('../utils/apiHelpers');
const { extractPaymentInfo, prepareBookingData, updatePaymentMaps } = require('../utils/bookingHelpers');
const { findBookingById, isCacheValid } = require('../utils/cacheHelpers');
const logger = require('../utils/logger');

class BookingService {
  constructor(maps, accessToken, bookingDataCache) {
    this.maps = maps;
    this.accessToken = accessToken;
    this.bookingDataCache = bookingDataCache;
    this.processedAppBookings = new Set();
  }

  async handleBookingConfirmation(request) {
    const payload = parseMultipartFormData(request.postData());
    if (!payload || payload.state !== 'success') return;

    logger.info(`Detected booking confirmation: bookId=${payload.book_id}, room=${payload.room}, state=${payload.state}`);

    try {
      const bookId = payload.book_id;
      let bookingInfo = {};
      if (payload.bookingInfo) {
        try {
          bookingInfo = JSON.parse(payload.bookingInfo);
          logger.debug(`Parsed booking info:`, bookingInfo);
        } catch (e) {
          logger.error(`Failed to parse bookingInfo JSON: ${e.message}`);
        }
      }

      // 초기 결제 상태 설정
      let amount = parseInt(bookingInfo.amount || 0, 10);
      let finished = false;
      const roomId = payload.room || bookingInfo.room;

      if (amount > 0 && !this.maps.paymentAmounts.has(bookId)) {
        this.maps.paymentAmounts.set(bookId, amount);
        logger.debug(`Setting initial payment amount for book_id ${bookId}: ${amount}`);
      }
      this.maps.paymentStatus.set(bookId, finished);

      // 최신 데이터 강제 가져오기
      await this._fetchLatestBookingsInfo();
      
      // 캐시에서 최신 데이터 확인 - 리팩토링된 로직 사용
      const hasLatestData = await this._checkLatestBookingData(bookId);
      if (hasLatestData) {
        amount = this.maps.paymentAmounts.get(bookId);
        finished = this.maps.paymentStatus.get(bookId);
        logger.info(`Updated to latest payment info from /owner/booking/ for book_id ${bookId}: amount=${amount}, finished=${finished}`);
      } else {
        logger.warn(`No latest booking data found, using initial amount for bookId ${bookId}`);
      }

      const finalAmount = this.maps.paymentAmounts.get(bookId) || amount;
      logger.info(`Using final payment amount for book_id ${bookId}: ${finalAmount}`);

      // 날짜 변환
      let startDate = bookingInfo.start_datetime ? convertKSTtoUTC(bookingInfo.start_datetime) : null;
      let endDate = bookingInfo.end_datetime ? convertKSTtoUTC(bookingInfo.end_datetime) : null;
      logger.debug(`Converted time - Start: ${startDate}, End: ${endDate}`);

      // 예약 데이터 준비 - 리팩토링된 로직 사용
      const apiData = prepareBookingData(
        {
          externalId: bookId,
          name: bookingInfo.name || payload.name || 'Unknown',
          phone: bookingInfo.phone || payload.phone || '010-0000-0000',
          person: bookingInfo.person || payload.person || 1,
          start_datetime: startDate,
          end_datetime: endDate,
          room: roomId || 'unknown',
          hole: bookingInfo.hole || '9'
        },
        finalAmount,
        finished,
        false
      );

      logger.debug(`Final API payment amount for ${bookId}: ${apiData.paymentAmount}`);
      
      // API 호출 - 리팩토링된 로직 사용
      await this._createBooking(apiData);
      this.processedAppBookings.add(bookId);
      logger.info(`Processed Confirmed Booking_Create for book_id: ${bookId}`);
    } catch (error) {
      logger.error(`Failed to process confirmed booking: ${error.message}`, error);
    }
  }

  async _fetchLatestBookingsInfo() {
    try {
      // 캐시 확인 - 리팩토링된 로직 사용
      if (isCacheValid(this.bookingDataCache, 60000)) {
        logger.info(`Using recent booking data from cache (${Math.round((Date.now() - this.bookingDataCache.timestamp)/1000)}s old)`);
        return this.bookingDataCache.data;
      }

      logger.info(`Fetching latest booking data`);
      const token = this.accessToken || await getAccessToken();
      const storeId = process.env.STORE_ID || this.maps.storeId;

      if (!storeId) {
        logger.error(`Store ID not found for fetching booking data`);
        return null;
      }

      const url = `${process.env.API_BASE_URL}/stores/${storeId}/reservation/crawl`;
      const axios = require('axios');
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.results) {
        this.bookingDataCache.data = response.data;
        this.bookingDataCache.timestamp = Date.now();
        logger.info(`Successfully fetched ${response.data.results.length} bookings`);
        return response.data;
      }
    } catch (error) {
      logger.error(`Failed to fetch latest booking data: ${error.message}`, error);
    }
    return null;
  }

  async handleBookingList(response, customerService) {
    logger.info(`Detected GET /owner/booking/ - will process pending updates after response`);
    const responseJson = await response.json();
    logger.debug(`Received booking data, caching it for future use`);

    this.bookingDataCache.data = responseJson;
    this.bookingDataCache.timestamp = Date.now();

    await this._handleCancelingBookings(responseJson);
    await handleBookingListingResponse(response, this.maps);
    await this._processAppBookings(responseJson, customerService);
    await processPendingBookingUpdates(this.accessToken, this.maps);

    if (customerService) {
      logger.info(`Processing ${customerService.recentCustomerIds.size} pending customer IDs with fresh booking data`);
      for (const customerId of customerService.recentCustomerIds) {
        customerService.processCustomerBookings(customerId, responseJson);
      }
    }
  }

  async handleBookingCreation(response, request) {
    await handleBookingCreateResponse(response.url(), response, this.maps.requestMap, this.accessToken, this.maps);
  }

  async _handleCancelingBookings(data) {
    logger.info(`Checking for canceling or canceled bookings in fresh booking data...`);
    const cancelingOrCanceledBookings = data.results?.filter(b => 
      (b.state === 'canceling' || b.state === 'canceled') && 
      !this.maps.processedBookings.has(b.book_id) && 
      !this.processedAppBookings.has(b.book_id)
    ) || [];

    if (cancelingOrCanceledBookings.length > 0) {
      logger.info(`Found ${cancelingOrCanceledBookings.length} canceling or canceled bookings to process`);
      for (const booking of cancelingOrCanceledBookings) {
        const bookId = booking.book_id;
        if (this.processedAppBookings.has(bookId) || this.maps.processedBookings.has(bookId)) {
          logger.info(`Skipping already processed canceled booking: ${bookId}`);
          continue;
        }
        try {
          // 리팩토링된 로직 사용
          await this._cancelBooking(bookId);
          logger.info(`Processed ${booking.state} booking: ${bookId}`);
        } catch (error) {
          logger.error(`Failed to process ${booking.state} booking: ${error.message}`, error);
        }
      }
    } else {
      logger.info(`No canceling or canceled bookings found`);
    }
  }

  async _processAppBookings(data, customerService) {
    if (!data.results || !Array.isArray(data.results)) return;

    logger.info(`Checking for app bookings in booking list...`);

    for (const booking of data.results) {
      if (!booking.book_id || !booking.customer) continue;

      const bookId = booking.book_id;
      const customerId = booking.customer;
      const customerUpdate = customerService?.customerUpdates?.get(customerId);

      if (this.maps.processedBookings.has(bookId) || this.processedAppBookings.has(bookId)) continue;

      const isCanceled = booking.state === 'canceled' || booking.state === 'canceling';
      const isSuccessful = booking.state === 'success';
      const isAppBooking = booking.book_type === 'U' || booking.confirmed_by === 'IM' || booking.immediate_booked === true;

      if (isAppBooking) {
        let matchingUpdate = false;
        let timeDiff = Infinity;

        if (customerUpdate && booking.customer_detail?.customerinfo_set?.length > 0) {
          const bookingUpdTime = new Date(booking.customer_detail.customerinfo_set[0].upd_date).getTime();
          const customerUpdTime = customerUpdate.updateTime;
          timeDiff = Math.abs(bookingUpdTime - customerUpdTime);
          if (timeDiff < 60000) {
            logger.info(`Found matching update times for booking ${bookId}`);
            matchingUpdate = true;
          }
        }

        const isRecentUpdate = matchingUpdate || (customerUpdate && (Date.now() - customerUpdate.timestamp < 60 * 1000));
        const isImmediateBooking = booking.immediate_booked === true || booking.confirmed_by === 'IM';

        // 결제 정보 추출 - 리팩토링된 로직 사용
        const { amount, finished } = extractPaymentInfo(booking);

        // 캐시 검증 및 갱신
        const cachedData = this.bookingDataCache.data?.results?.find(b => b.book_id === bookId);
        if (cachedData && cachedData.finished !== finished) {
          logger.debug(`Cache mismatch for ${bookId}: cached finished=${cachedData.finished}, actual finished=${finished}`);
          cachedData.amount = amount;
          cachedData.finished = finished;
          this.bookingDataCache.timestamp = Date.now();
        }

        if (isCanceled && matchingUpdate) {
          await this._cancelBooking(bookId);
          logger.info(`Processed canceled app booking: ${bookId}`);
        } else if ((isSuccessful || isImmediateBooking) && !this.processedAppBookings.has(bookId)) {
          // 예약 데이터 준비 - 리팩토링된 로직 사용
          const bookingData = prepareBookingData(booking, amount, finished, isImmediateBooking);

          logger.debug(`Final check before Booking_Create for book_id ${bookId}: amount=${amount}, paymented=${finished}`);
          logger.debug(`Sending API data for booking:`, bookingData);

          await this._createBooking(bookingData);
          this.processedAppBookings.add(bookId);
          logger.info(`Processed App Booking_Create for book_id: ${bookId}`);
        }
      }
    }
  }

  // 리팩토링된 메서드 - apiHelpers 사용
  async _createBooking(data) {
    const token = this.accessToken || await getAccessToken();
    logger.debug(`Sending API data for booking:`, data);
    
    await createBooking(
      data, 
      token, 
      this.maps.processedBookings, 
      this.maps.paymentAmounts, 
      this.maps.paymentStatus
    );
  }

  // 리팩토링된 메서드 - apiHelpers 사용
  async _cancelBooking(bookId) {
    const token = this.accessToken || await getAccessToken();
    logger.info(`Processing Booking_Cancel for book_id: ${bookId}`);
    
    try {
      await cancelBooking(
        bookId, 
        'App User', 
        token, 
        this.maps.processedBookings, 
        this.maps.paymentAmounts, 
        this.maps.paymentStatus
      );
      
      this.processedAppBookings.add(bookId);
      this.maps.processedBookings.add(bookId);
      logger.info(`Successfully canceled booking: ${bookId}`);
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.error === 'ALREADY_CANCELLED') {
        logger.info(`Booking ${bookId} was already canceled, marking as processed`);
        this.processedAppBookings.add(bookId);
        this.maps.processedBookings.add(bookId);
      } else {
        logger.error(`Failed to cancel booking ${bookId}: ${error.message}`, error);
      }
    }
  }

  // 리팩토링된 메서드 - bookingHelpers 사용
  async _checkLatestBookingData(bookId) {
    const booking = findBookingById(bookId, this.bookingDataCache);
    if (booking) {
      const { amount, finished } = extractPaymentInfo(booking);
      logger.info(`Found latest booking data for book_id ${bookId} in cache: amount=${amount}, finished=${finished}`);
      
      updatePaymentMaps(bookId, { amount, finished }, this.maps.paymentAmounts, this.maps.paymentStatus);
      return true;
    }

    logger.debug(`No latest booking data found in cache for book_id ${bookId}`);
    return false;
  }
}

module.exports = BookingService;