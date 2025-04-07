// utils/apiHelpers.js
// 기존 api.js에서 확장된 API 관련 헬퍼 함수들입니다.
const { getAccessToken, sendTo24GolfApi } = require('./api');
const logger = require('./logger');

/**
 * 예약 생성 API 호출 헬퍼 함수
 * @param {Object} bookingData 생성할 예약 데이터
 * @param {string} accessToken 액세스 토큰
 * @param {Set} processedBookings 처리된 예약 집합
 * @param {Map} paymentAmounts 결제 금액 맵
 * @param {Map} paymentStatus 결제 상태 맵
 * @returns {Promise<Object>} API 응답 데이터
 */
const createBooking = async (bookingData, accessToken, processedBookings, paymentAmounts, paymentStatus) => {
  const token = accessToken || await getAccessToken();
  logger.debug(`Sending API data for booking:`, bookingData);
  
  try {
    const result = await sendTo24GolfApi(
      'Booking_Create', 
      '', 
      {}, 
      bookingData, 
      token, 
      processedBookings, 
      paymentAmounts, 
      paymentStatus
    );
    
    // 성공적으로 처리되었다면 processedBookings에 추가
    if (bookingData.externalId) {
      processedBookings.add(bookingData.externalId);
    }
    
    return result;
  } catch (error) {
    logger.error(`Failed to create booking:`, error);
    throw error;
  }
};

/**
 * 예약 취소 API 호출 헬퍼 함수
 * @param {string} bookId 취소할 예약 ID
 * @param {string} canceledBy 취소자 정보
 * @param {string} accessToken 액세스 토큰
 * @param {Set} processedBookings 처리된 예약 집합
 * @param {Map} paymentAmounts 결제 금액 맵
 * @param {Map} paymentStatus 결제 상태 맵
 * @returns {Promise<Object>} API 응답 데이터
 */
const cancelBooking = async (bookId, canceledBy, accessToken, processedBookings, paymentAmounts, paymentStatus) => {
  const token = accessToken || await getAccessToken();
  logger.info(`Processing Booking_Cancel for book_id: ${bookId}`);
  
  try {
    const result = await sendTo24GolfApi(
      'Booking_Cancel', 
      '', 
      { 
        canceled_by: canceledBy || 'App User', 
        externalId: bookId 
      }, 
      null, 
      token, 
      processedBookings, 
      paymentAmounts, 
      paymentStatus
    );
    
    processedBookings.add(bookId);
    logger.info(`Successfully canceled booking: ${bookId}`);
    return result;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.error === 'ALREADY_CANCELLED') {
      logger.info(`Booking ${bookId} was already canceled`);
      processedBookings.add(bookId);
      return { success: true, alreadyCancelled: true };
    }
    logger.error(`Failed to cancel booking: ${bookId}`, error);
    throw error;
  }
};

/**
 * 예약 업데이트 API 호출 헬퍼 함수
 * @param {Object} bookingData 업데이트할 예약 데이터
 * @param {string} accessToken 액세스 토큰
 * @param {Set} processedBookings 처리된 예약 집합
 * @param {Map} paymentAmounts 결제 금액 맵
 * @param {Map} paymentStatus 결제 상태 맵
 * @returns {Promise<Object>} API 응답 데이터
 */
const updateBooking = async (bookingData, accessToken, processedBookings, paymentAmounts, paymentStatus) => {
  const token = accessToken || await getAccessToken();
  const bookId = bookingData.externalId;
  
  logger.debug(`Updating booking ${bookId} with data:`, bookingData);
  
  try {
    return await sendTo24GolfApi(
      'Booking_Update', 
      '', 
      {}, 
      bookingData, 
      token, 
      processedBookings, 
      paymentAmounts, 
      paymentStatus
    );
  } catch (error) {
    logger.error(`Failed to update booking ${bookId}:`, error);
    throw error;
  }
};

module.exports = {
  createBooking,
  cancelBooking,
  updateBooking
};