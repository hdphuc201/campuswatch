/** Trims, collapses whitespace, and uses the composed Unicode form (Vietnamese diacritics). */
export function cleanText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Folds text for matching: lowercase, no diacritics, `đ` → `d`, punctuation → spaces.
 * "Điểm TK (10)" → "diem tk 10".
 */
export function foldText(value: string | null | undefined): string {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Text directly inside an element, excluding its child elements. */
export function ownText(element: Element): string {
  let text = '';
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3) {
      text += node.textContent ?? '';
    }
  }
  return cleanText(text);
}

/** Cell text with line breaks (`<br>`) turned into spaces. */
export function cellText(cell: Element | undefined): string {
  if (!cell) {
    return '';
  }
  const clone = cell.cloneNode(true) as Element;
  for (const br of Array.from(clone.querySelectorAll('br'))) {
    br.replaceWith(' ');
  }
  return cleanText(clone.textContent);
}
