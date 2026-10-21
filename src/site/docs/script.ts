// The articles' script, at the end of each article: a code block's Copy button
// works as the Run page's does; the documentation menu scrolls its own box to
// the reader's place; and a table too wide for the column, even with its words
// whole, stacks into cards (docs.css) until the column is wide enough for it.
export const ARTICLE_SCRIPT = `{
  document.addEventListener('click', async event => {
    const button = event.target.closest('.docs-copy')
    if (!button) return
    try {
      await navigator.clipboard.writeText(button.dataset.copy)
      const label = button.querySelector('span')
      label.textContent = 'Copied'
      setTimeout(() => { label.textContent = 'Copy' }, 1600)
    } catch {}
  })
  const side = document.querySelector('.docs-side'), place = side && side.querySelector('[aria-current]')
  if (place) {
    const box = side.getBoundingClientRect(), item = place.getBoundingClientRect()
    const top = Math.max(box.top, 0), bottom = Math.min(box.bottom, innerHeight)
    if (item.top < top || item.bottom > bottom) side.scrollTop += item.top - (top + bottom - item.height) / 2
  }
  const tables = document.querySelectorAll('.docs-table')
  const fit = () => {
    for (const box of tables) {
      if (box.classList.contains('docs-stack')) {
        if (box.clientWidth + 1 < box.dataset.width) continue
        box.classList.remove('docs-stack')
      }
      if (box.scrollWidth > box.clientWidth + 1) {
        box.dataset.width = box.scrollWidth
        box.classList.add('docs-stack')
      }
    }
  }
  fit()
  document.fonts.ready.then(() => { for (const box of tables) box.classList.remove('docs-stack'); fit() })
  const watch = new ResizeObserver(() => requestAnimationFrame(fit))
  for (const box of tables) { watch.observe(box); watch.observe(box.firstElementChild) }
}`
