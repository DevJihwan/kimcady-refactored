// utils/cacheHelpers.js

/**
 * 캐시 유효성 검사 함수
 * @param {Object} cache {data, timestamp} 형태의 캐시 객체
 * @param {number} timeoutMs 캐시 타임아웃 (밀리초)
 * @returns {boolean} 캐시가 유효한지 여부
 */
const isCacheValid = (cache, timeoutMs = 60000) => {
  return cache && cache.data && (Date.now() - cache.timestamp < timeoutMs);
};

/**
 * 캐시 데이터 업데이트 함수
 * @param {Object} cache {data, timestamp} 형태의 캐시 객체 (참조로 전달)
 * @param {any} data 캐시할 데이터
 * @returns {Object} 업데이트된 캐시 객체
 */
const updateCache = (cache, data) => {
  cache.data = data;
  cache.timestamp = Date.now();
  return cache;
};

/**
 * 캐시에서 특정 예약 ID를 찾는 함수
 * @param {string} bookId 찾을 예약 ID
 * @param {Object} bookingCache 예약 데이터 캐시 객체
 * @returns {Object|null} 찾은 예약 데이터 또는 null
 */
const findBookingById = (bookId, bookingCache) => {
  if (!bookingCache.data?.results || !Array.isArray(bookingCache.data.results)) {
    return null;
  }
  
  return bookingCache.data.results.find(booking => booking.book_id === bookId) || null;
};

/**
 * 캐시에서 특정 고객 ID에 해당하는 예약을 찾는 함수
 * @param {string} customerId 고객 ID
 * @param {Object} bookingCache 예약 데이터 캐시 객체
 * @param {string} state 필터링할 예약 상태 (optional)
 * @returns {Array} 찾은 예약 데이터 배열
 */
const findBookingsByCustomerId = (customerId, bookingCache, state = null) => {
  if (!bookingCache.data?.results || !Array.isArray(bookingCache.data.results)) {
    return [];
  }
  
  let bookings = bookingCache.data.results.filter(booking => booking.customer === customerId);
  
  if (state) {
    bookings = bookings.filter(booking => booking.state === state);
  }
  
  return bookings;
};

/**
 * 캐시 정리 함수 - 오래된 데이터 제거
 * @param {Map} cacheMap 캐시 맵 객체
 * @param {number} timeoutMs 캐시 타임아웃 (밀리초)
 */
const cleanupCacheMap = (cacheMap, timeoutMs = 300000) => {
  const now = Date.now();
  for (const [key, cache] of cacheMap.entries()) {
    if (now - cache.timestamp > timeoutMs) {
      cacheMap.delete(key);
    }
  }
};

module.exports = {
  isCacheValid,
  updateCache,
  findBookingById,
  findBookingsByCustomerId,
  cleanupCacheMap
};