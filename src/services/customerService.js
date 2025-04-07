// services/customerService.js
const { getAccessToken } = require('../utils/api');
const { createBooking } = require('../utils/apiHelpers');
const { extractPaymentInfo, prepareBookingData } = require('../utils/bookingHelpers');
const { isCacheValid, findBookingsByCustomerId } = require('../utils/cacheHelpers');
const logger = require('../utils/logger');

class CustomerService {
  constructor(maps, accessToken, processedCustomerRequests, bookingDataCache) {
    this.maps = maps;
    this.accessToken = accessToken;
    this.processedCustomerRequests = processedCustomerRequests;
    this.bookingDataCache = bookingDataCache;
    this.customerUpdates = new Map();
    this.recentCustomerIds = new Set();
    this.processedAppBookings = new Set();
  }

  async handleCustomerResponse(response) {
    logger.debug(`Processing customer info API response: ${response.url()}`);
    const customerData = await response.json();
    const customerId = customerData?.id;
    if (!customerId) return;

    logger.debug(`Detected customerId: ${customerId}`);
    this._storeCustomerUpdate(customerData);
    
    // 이미 처리 중인 고객 ID는 건너뜀
    if (this.recentCustomerIds.has(customerId) || this.processedCustomerRequests.has(customerId)) {
      logger.info(`Already processing customer ${customerId}, skipping duplicate check`);
      return;
    }

    // 요청 중복 방지
    this.recentCustomerIds.add(customerId);
    this.processedCustomerRequests.add(customerId);
    logger.info(`Added customer ${customerId} to recent checks, will process after booking data is received`);

    // 최신 예약 데이터를 얻은 후 처리 (10초 후)
    setTimeout(() => this._processPendingCustomer(customerId), 10000);
  }

  _storeCustomerUpdate(data) {
    // 고객 정보 중 최근 업데이트 정보 확인
    let latestUpdateTime = null;
    if (data.customerinfo_set && Array.isArray(data.customerinfo_set) && data.customerinfo_set.length > 0) {
      const customerInfo = data.customerinfo_set[0];
      if (customerInfo.upd_date) {
        latestUpdateTime = new Date(customerInfo.upd_date).getTime();
      }
    }
    
    logger.info(`Detected customer info access - customerId: ${data.id}, name: ${data.name || ''}, updateTime: ${latestUpdateTime}`);
    
    // 현재 시간 기준으로 최근 업데이트된 고객 정보만 저장 (30초 이내)
    const now = Date.now();
    const thirtySecondsAgo = now - 30 * 1000;
    
    if (latestUpdateTime && latestUpdateTime > thirtySecondsAgo) {
      logger.info(`Storing recent customer update for customerId: ${data.id}`);
      this.customerUpdates.set(data.id, {
        id: data.id,
        name: data.name || '',
        phone: data.phone || '',
        updateTime: latestUpdateTime,
        timestamp: now
      });
    }
  }

  async _processPendingCustomer(customerId) {
    try {
      // 캐시된 예약 데이터 확인 - 리팩토링된 로직 사용
      if (isCacheValid(this.bookingDataCache, 60000)) {
        logger.info(`Using cached booking data from ${new Date(this.bookingDataCache.timestamp).toISOString()}`);
        await this.processCustomerBookings(customerId, this.bookingDataCache.data);
      } else {
        logger.info(`Waiting for next booking data to process customer ${customerId}`);
        // 다음 예약 데이터가 수신될 때까지 기다림 - 주기적으로 요청되는 데이터
      }
    } catch (e) {
      logger.error(`Failed to process customer ${customerId} bookings: ${e.message}`, e);
    } finally {
      // 처리 완료 후 Set에서 제거
      this.recentCustomerIds.delete(customerId);
      // 1분 후에 processedCustomerRequests에서 제거 (중복 요청 방지 해제)
      setTimeout(() => {
        this.processedCustomerRequests.delete(customerId);
        logger.info(`Removed customer ${customerId} from processed requests after 1 minute`);
      }, 60000);
      logger.info(`Removed customer ${customerId} from recent checks after processing`);
    }
  }

  async processCustomerBookings(customerId, bookingData) {
    logger.info(`Processing bookings for customer ${customerId}`);
    const { paymentAmounts, paymentStatus, processedBookings } = this.maps;
    
    try {
      if (!bookingData.results || !Array.isArray(bookingData.results)) {
        logger.warn(`No booking results found in data`);
        return;
      }
      
      // 리팩토링된 로직 사용 - 고객 ID에 해당하는 성공 상태 예약만 필터링
      const customerBookings = findBookingsByCustomerId(customerId, { data: bookingData }, 'success')
        .filter(booking => 
          !processedBookings.has(booking.book_id) &&
          !this.processedAppBookings.has(booking.book_id)
        );
      
      logger.info(`Found ${customerBookings.length} success bookings for customer ${customerId}`);
      
      if (customerBookings.length > 0) {
        // 최신 업데이트 순으로 정렬
        customerBookings.sort((a, b) => {
          const aDate = new Date(a.customer_detail?.customerinfo_set?.[0]?.upd_date || 0);
          const bDate = new Date(b.customer_detail?.customerinfo_set?.[0]?.upd_date || 0);
          return bDate - aDate;
        });
        
        // 최신 예약 처리
        for (const booking of customerBookings) {
          const bookId = booking.book_id;
          logger.debug(`Processing booking: ${bookId}`);
          
          // 결제 정보 가져오기 - 리팩토링된 로직 사용
          const { amount, finished } = extractPaymentInfo(booking);
          
          logger.debug(`Booking info - book_id: ${bookId}, customer: ${booking.customer}, state: ${booking.state}`);
          logger.debug(`Extracted payment info for book_id ${bookId}: amount=${amount}, finished=${finished}`);
          
          // 맵에 저장
          paymentAmounts.set(bookId, amount);
          paymentStatus.set(bookId, finished);
          
          // 예약 처리 데이터 준비 - 리팩토링된 로직 사용
          const bookingData = prepareBookingData(
            booking,
            amount,
            finished,
            booking.immediate_booked || false
          );
          
          logger.debug(`Final API payment amount for customer booking ${bookId}: ${bookingData.paymentAmount}`);
          
          try {
            // 유효한 토큰 확인
            let currentToken = this.accessToken;
            if (!currentToken) {
              logger.debug(`No access token available, fetching new one`);
              currentToken = await getAccessToken();
            }
            
            logger.info(`Processing Auto Booking_Create for book_id: ${bookId}`);
            logger.debug(`Sending API data for auto booking:`, bookingData);
            
            // 예약 등록 API 호출 - 리팩토링된 로직 사용
            await createBooking(
              bookingData,
              currentToken,
              processedBookings,
              paymentAmounts,
              paymentStatus
            );
            
            logger.info(`Requested Auto Booking_Create for book_id: ${bookId}`);
            this.processedAppBookings.add(bookId);
          } catch (error) {
            logger.error(`Failed to process Auto Booking_Create: ${error.message}`, error);
          }
        }
      } else {
        logger.info(`No new success bookings found for customer ${customerId}`);
      }
    } catch (e) {
      logger.error(`Failed to process customer bookings: ${e.message}`, e);
    }
  }

  // 오래된 고객 업데이트 정보 정리
  cleanUpOldUpdates() {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    for (const [customerId, data] of this.customerUpdates.entries()) {
      if (data.timestamp < fiveMinutesAgo) {
        this.customerUpdates.delete(customerId);
      }
    }
    
    // 오래된 처리 정보 정리 (하루에 한 번)
    if (this.processedAppBookings.size > 1000) {
      logger.info(`Clearing old processed app bookings (size=${this.processedAppBookings.size})`);
      this.processedAppBookings.clear();
    }
  }
}

module.exports = CustomerService;