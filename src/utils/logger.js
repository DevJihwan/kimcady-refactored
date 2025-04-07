// utils/logger.js

/**
 * 일관된 로그 포맷으로 출력하는 함수들
 * 기존 로그 형식과 일치하도록 유지합니다.
 */

/**
 * 디버그 레벨 로그 출력
 * @param {string} message 로그 메시지
 * @param {any} data 추가 데이터 (선택적)
 */
const logDebug = (message, data = null) => {
  const formattedMessage = `[DEBUG] ${message}`;
  if (data) {
    if (typeof data === 'object') {
      console.log(formattedMessage, JSON.stringify(data, null, 2));
    } else {
      console.log(formattedMessage, data);
    }
  } else {
    console.log(formattedMessage);
  }
};

/**
 * 정보 레벨 로그 출력
 * @param {string} message 로그 메시지
 * @param {any} data 추가 데이터 (선택적)
 */
const logInfo = (message, data = null) => {
  const formattedMessage = `[INFO] ${message}`;
  if (data) {
    if (typeof data === 'object') {
      console.log(formattedMessage, JSON.stringify(data, null, 2));
    } else {
      console.log(formattedMessage, data);
    }
  } else {
    console.log(formattedMessage);
  }
};

/**
 * 경고 레벨 로그 출력
 * @param {string} message 로그 메시지
 * @param {any} data 추가 데이터 (선택적)
 */
const logWarn = (message, data = null) => {
  const formattedMessage = `[WARN] ${message}`;
  if (data) {
    if (typeof data === 'object') {
      console.log(formattedMessage, JSON.stringify(data, null, 2));
    } else {
      console.log(formattedMessage, data);
    }
  } else {
    console.log(formattedMessage);
  }
};

/**
 * 에러 레벨 로그 출력
 * @param {string} message 에러 메시지
 * @param {Error|string|Object} error 에러 객체 또는 추가 정보 (선택적)
 */
const logError = (message, error = null) => {
  const formattedMessage = `[ERROR] ${message}`;
  console.error(formattedMessage);
  
  if (error) {
    if (error.stack) {
      console.error(`[ERROR] Stack trace:`, error.stack);
    } else if (typeof error === 'object') {
      console.error(`[ERROR] Details:`, JSON.stringify(error, null, 2));
    } else {
      console.error(`[ERROR] Details:`, error);
    }
  }
};

module.exports = {
  debug: logDebug,
  info: logInfo,
  warn: logWarn,
  error: logError
};