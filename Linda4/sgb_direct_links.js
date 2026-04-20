(function (global) {
  'use strict';

  const BOOKS = [
    {
      key: 'sgb xi',
      aliases: ['sgb 11', 'sgb xi', 'sgb11'],
      label: 'SGB XI',
      url: 'https://www.gesetze-im-internet.de/sgb_11/'
    },
    {
      key: 'sgb v',
      aliases: ['sgb 5', 'sgb v', 'sgb5'],
      label: 'SGB V',
      url: 'https://www.gesetze-im-internet.de/sgb_5/'
    }
  ];

  const normalize = (value) => String(value || '')
    .toLowerCase()
    .replace(/[\u00a0\s]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const detectBook = (text) => {
    const raw = normalize(text);
    if (!raw) return null;
    return BOOKS.find((book) => {
      const key = normalize(book.key);
      const label = normalize(book.label);
      const aliases = [key, label, ...(Array.isArray(book.aliases) ? book.aliases : [])]
        .map((item) => normalize(item))
        .filter(Boolean);
      return aliases.some((item) => raw.includes(item));
    }) || null;
  };

  const detectParagraph = (text) => {
    const raw = String(text || '');
    const patterns = [
      /(?:^|[^\p{L}\p{N}])§\s*([0-9]{1,3}[a-z]?)/iu,
      /(?:^|[^\p{L}\p{N}])paragraph\s*([0-9]{1,3}[a-z]?)/iu,
      /(?:^|[^\p{L}\p{N}])absatz\s*([0-9]{1,3}[a-z]?)/iu
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match && match[1]) return String(match[1]).replace(/\s+/g, '').toLowerCase();
    }
    return '';
  };

  const resolveSource = (source = {}, context = {}) => {
    const combined = [
      source.title,
      source.section,
      source.excerpt,
      source.note,
      source.url,
      context.question,
      context.answerText
    ]
      .filter(Boolean)
      .join(' ');

    const book = detectBook(combined);
    if (!book) return null;

    const paragraph = detectParagraph(combined);
    const url = paragraph ? `${book.url}__${paragraph}.html` : book.url;
    const label = paragraph ? `Direktabsprung § ${paragraph} ${book.label}` : `Direktabsprung ${book.label}`;

    return {
      kind: 'sgb',
      book: book.label,
      paragraph,
      url,
      label,
      bookUrl: book.url
    };
  };

  global.LINDA_SGB_DIRECT_LINKS = {
    resolveSource
  };
})(window);
