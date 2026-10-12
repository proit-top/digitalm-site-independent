(function (global) {
  'use strict';

  function validEmail(value) {
    return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value);
  }

  function validPhone(value) {
    return /^[0-9+() .\-]{5,40}$/u.test(value) && (value.match(/\d/gu) || []).length >= 5;
  }

  function validateContact(emailValue, phoneValue) {
    const email = String(emailValue ?? '').trim();
    const phone = String(phoneValue ?? '').trim();
    const errors = {};

    if (!email && !phone) {
      errors.email = 'Укажите email или телефон.';
      errors.phone = 'Укажите email или телефон.';
      return { valid: false, errors };
    }
    if (email && !validEmail(email)) {
      errors.email = 'Введите корректный e-mail, например name@example.com.';
    }
    if (phone && !validPhone(phone)) {
      errors.phone = 'Введите телефон минимум с пятью цифрами или очистите это поле.';
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }

  global.DigitalMFormValidation = Object.freeze({ validateContact });
})(window);
