const FORM_CONTACT = 'связаться';
const FORM_CASES = 'кейсы';

export class ValidationError extends Error {
  constructor(message, code = 'invalid_submission') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

function text(value, field, max) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new ValidationError(`Некорректное поле: ${field}`);
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '').trim();
  if (cleaned.length > max) throw new ValidationError(`Поле слишком длинное: ${field}`);
  return cleaned;
}

function validPhone(value) {
  return /^[0-9+() .\-]{5,40}$/u.test(value) && (value.match(/\d/gu) || []).length >= 5;
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value);
}

export function buildLeadFields(input, submittedAt = new Date().toISOString()) {
  const source = text(input.source, 'source', 32);
  if (source !== FORM_CONTACT && source !== FORM_CASES) {
    throw new ValidationError('Неизвестный тип формы');
  }
  if (input.agree !== 'on' && input.agree !== 'true') {
    throw new ValidationError('Необходимо согласие на обработку персональных данных', 'consent_required');
  }
  if (text(input.website, 'website', 200)) {
    throw new ValidationError('Автоматическая отправка отклонена', 'spam_detected');
  }

  const name = text(input.name, 'name', 120);
  const company = text(input.company, 'company', 120);
  const email = text(input.email, 'email', 254);
  const phone = text(input.phone, 'phone', 40);
  const task = text(input.task, 'task', 4000);
  const contact = text(input.contact, 'contact', 254);

  if (!name) throw new ValidationError('Укажите имя', 'name_required');
  if (email && !validEmail(email)) throw new ValidationError('Некорректный адрес электронной почты', 'email_invalid');
  if (phone && !validPhone(phone)) throw new ValidationError('Некорректный номер телефона', 'phone_invalid');

  const fields = {
    TITLE: source === FORM_CONTACT ? 'Заявка с сайта — Связаться' : 'Запрос кейсов с сайта',
    NAME: name,
    SOURCE_DESCRIPTION: `digitalm.agency — форма «${source === FORM_CONTACT ? 'Связаться' : 'Кейсы'}»`,
    COMMENTS: '',
  };
  if (company) fields.COMPANY_TITLE = company;

  const emailValue = email || (source === FORM_CASES && validEmail(contact) ? contact : '');
  const phoneValue = phone || (source === FORM_CASES && validPhone(contact) ? contact : '');
  if (emailValue) fields.EMAIL = [{ VALUE: emailValue, VALUE_TYPE: 'WORK' }];
  if (phoneValue) fields.PHONE = [{ VALUE: phoneValue, VALUE_TYPE: 'WORK' }];

  const notes = [`Форма: ${source === FORM_CONTACT ? 'Связаться' : 'Кейсы'}`];
  if (source === FORM_CONTACT && task) notes.push(`Задача: ${task}`);
  if (source === FORM_CASES && contact && !emailValue && !phoneValue) notes.push(`Контакт: ${contact}`);
  notes.push(`Согласие на обработку персональных данных: получено (${submittedAt}); политика: https://digitalm.agency/politika.html`);
  fields.COMMENTS = notes.join('\n');

  if (source === FORM_CONTACT && !emailValue && !phoneValue) {
    throw new ValidationError('Укажите телефон или электронную почту', 'contact_required');
  }
  if (source === FORM_CASES && !contact) {
    throw new ValidationError('Укажите контакт для связи', 'contact_required');
  }
  return fields;
}
