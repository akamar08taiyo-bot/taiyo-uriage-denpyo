export function printDoc(orientation = 'portrait') {
  const style = document.createElement('style')
  style.dataset.printOrientation = 'true'
  style.textContent = `@page { size: A4 ${orientation}; margin: 10mm; }`
  document.head.appendChild(style)
  window.addEventListener('afterprint', () => style.remove(), { once: true })
  window.print()
}
