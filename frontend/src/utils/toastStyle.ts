// Per-viewer toast look (1-5), chosen in Settings → Appearance. localStorage only; falls back to 1.
export type ToastStyle = 1 | 2 | 3 | 4 | 5;

export const TOAST_STYLE_OPTIONS: { id: ToastStyle; label: string; desc: string }[] = [
  { id: 1, label: 'Slim pill', desc: 'Top centre, one line' },
  { id: 2, label: 'Card with coloured edge', desc: 'Top right' },
  { id: 3, label: 'Full-width banner', desc: 'Very top, hard to miss' },
  { id: 4, label: 'Small badge', desc: 'Top right, quiet' },
  { id: 5, label: 'Card with close button', desc: 'Top right' },
];

export function getToastStyle(): ToastStyle {
  try {
    const n = Number(localStorage.getItem('app_toast_style'));
    return n >= 1 && n <= 5 ? (n as ToastStyle) : 1;
  } catch {
    return 1;
  }
}

export function setToastStyle(style: ToastStyle): void {
  try {
    localStorage.setItem('app_toast_style', String(style));
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('toast-style-changed'));
}
