const lotItemSchema = {
  type: 'object',
  properties: {
    item_id: { type: 'string', description: 'ID лота Goofish' },
    price_cny: { type: 'number', description: 'Цена лота в юанях' },
  },
  required: ['item_id', 'price_cny'],
  additionalProperties: false,
};

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'goofish_search',
    stage: 'search',
    description:
      'Поиск лотов на Goofish по ключевому слову. Возвращает краткие карточки: item_id, заголовок, цена, локация, продавец, дата. Используй personal_only=true для частных продавцов.',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Поисковый запрос на китайском' },
        price_min: { type: 'number', description: 'Минимальная цена в юанях' },
        price_max: { type: 'number', description: 'Максимальная цена в юанях' },
        sort: { type: 'string', enum: ['new', 'price_asc'], description: 'Сортировка: new или price_asc' },
        page: { type: 'integer', minimum: 1, description: 'Номер страницы, с 1' },
        personal_only: { type: 'boolean', description: 'Только частные продавцы' },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
  },
  {
    name: 'goofish_item',
    stage: 'item',
    description:
      'Полная карточка лота: цена, статус, описание, теги состояния, доставка, локация, счётчики, seller_id и URL фото. Проверяй ею стоп-факторы.',
    parameters: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'ID лота' },
      },
      required: ['item_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'goofish_seller',
    stage: 'seller',
    description: 'Профиль продавца: рейтинг Zhima, верификация, дата регистрации, число продаж, доля положительных отзывов, примеры лотов.',
    parameters: {
      type: 'object',
      properties: {
        seller_id: { type: 'string', description: 'ID продавца из карточки лота' },
      },
      required: ['seller_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'goofish_reviews',
    stage: 'reviews',
    description: 'Отзывы о продавце. Ищи жалобы на подделку, несоответствие товара, ремонт, неотправку. Нет отзывов это неизвестность, а не обвинение.',
    parameters: {
      type: 'object',
      properties: {
        seller_id: { type: 'string', description: 'ID продавца' },
        page: { type: 'integer', minimum: 1, description: 'Страница отзывов, с 1' },
      },
      required: ['seller_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'view_images',
    stage: 'images',
    description:
      'Передаёт до 4 фотографий лота модели как изображения. Приоритет: экран 关于本机, 电池健康, отчёты 沙漏验机/爱思助手, экран, задняя крышка, углы, комплект.',
    parameters: {
      type: 'object',
      properties: {
        urls: { type: 'array', items: { type: 'string' }, description: 'URL фото из карточки лота' },
        max: { type: 'integer', minimum: 1, maximum: 4, description: 'Сколько фото передать, максимум 4' },
      },
      required: ['urls'],
      additionalProperties: false,
    },
  },
  {
    name: 'calc_price',
    stage: 'calc',
    description:
      'Единственный источник курса CNY/RUB и итоговых цен. Передай budget_rub для пересчёта бюджета в юани и/или items из top для расчёта base/commission/final.',
    parameters: {
      type: 'object',
      properties: {
        budget_rub: { type: 'number', description: 'Бюджет клиента в рублях' },
        items: { type: 'array', items: lotItemSchema, maxItems: 3, description: 'Лоты для расчёта итоговой цены' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'finish',
    stage: 'finish',
    description: 'Сдать итоговый JSON по схеме из системного промта. Вызывается ровно один раз и последним.',
    parameters: {
      type: 'object',
      properties: {
        result: {
          type: 'object',
          description: 'Итоговый объект строго по схеме раздела 13 системного промта',
          additionalProperties: true,
        },
      },
      required: ['result'],
      additionalProperties: false,
    },
  },
]);

export const TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.name);
export const TOOL_BY_NAME = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));
