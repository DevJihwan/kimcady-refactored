// utils/bookingHelpers.js
const { convertKSTtoUTC } = require('./api');

/**
 * 예약 데이터에서 결제 정보를 추출하는 함수
 * @param {Object} booking 예약 데이터 객체
 * @returns {Object} {amount, finished} 형태의 결제 금액 및 완료 여부
 */
const extractPaymentInfo = (booking) => {
  const revenueDetail = booking.revenue_detail || {};
  let amount = parseInt(revenueDetail.amount || booking.amount || 0, 10);
  let finished = revenueDetail.finished === true || revenueDetail.finished === 'true';

  if (!booking.revenue_detail && booking.payment) {
    amount = parseInt(booking.payment.amount || booking.amount || 0, 10);
    finished = booking.is_paid === true;
  } else if (booking.revenue_detail && booking.is_paid) {
    finished = booking.is_paid === true; // is_paid가 우선
  }

  return { amount, finished };
};

/**
 * 24골프 API에 전송할 예약 데이터 객체를 생성하는 함수
 * @param {Object} booking 원본 예약 데이터
 * @param {number} amount 결제 금액
 * @param {boolean} finished 결제 완료 여부
 * @param {boolean} immediate 즉시 예약 여부
 * @returns {Object} API 전송용 예약 데이터 객체
 */
const prepareBookingData = (booking, amount, finished, immediate = false) => {
  const bookId = booking.book_id || booking.externalId;
  const startDate = booking.start_datetime ? convertKSTtoUTC(booking.start_datetime) : null;
  const endDate = booking.end_datetime ? convertKSTtoUTC(booking.end_datetime) : null;

  return {
    externalId: bookId,
    name: booking.name || 'Unknown',
    phone: booking.phone || '010-0000-0000',
    partySize: parseInt(booking.person || 1, 10),
    startDate,
    endDate,
    roomId: booking.room?.toString() || booking.roomId || 'unknown',
    hole: booking.hole,
    paymented: finished,
    paymentAmount: amount,
    crawlingSite: 'KimCaddie',
    immediate: booking.immediate_booked === true || immediate
  };
};

/**
 * 캐시된 예약 데이터에서 특정 예약을 찾는 함수
 * @param {string} bookId 예약 ID
 * @param {Object} bookingDataCache 캐시된 예약 데이터
 * @returns {Object|null} 찾은 예약 데이터 또는 null
 */
const findBookingInCache = (bookId, bookingDataCache) => {
  if (!bookingDataCache.data?.results) return null;
  return bookingDataCache.data.results.find(item => item.book_id === bookId) || null;
};

/**
 * 예약 데이터에서 매장 정보를 업데이트하는 함수
 * @param {string} bookId 예약 ID
 * @param {Object} paymentInfo 결제 정보 {amount, finished}
 * @param {Map} paymentAmounts 결제 금액 맵
 * @param {Map} paymentStatus 결제 상태 맵
 */
const updatePaymentMaps = (bookId, paymentInfo, paymentAmounts, paymentStatus) => {
  if (bookId) {
    if (paymentInfo.amount > 0) {
      paymentAmounts.set(bookId, paymentInfo.amount);
    }
    paymentStatus.set(bookId, paymentInfo.finished);
  }
};

module.exports = {
  extractPaymentInfo,
  prepareBookingData,
  findBookingInCache,
  updatePaymentMaps
};