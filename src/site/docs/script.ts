// The articles' script, at the end of each article: a code block's Copy button
// works as the Run page's does; the documentation menu scrolls its own box to
// the reader's place; and a table too wide for the column, which scrolls in
// its own box, is a named, focusable region with a visible edge (docs.css)
// for as long as it scrolls.
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
  const edge = () => {
    for (const box of tables) {
      const wide = box.scrollWidth > box.clientWidth + 1
      if (wide === box.hasAttribute('tabindex')) continue
      if (!wide) { for (const name of ['tabindex', 'role', 'aria-label']) box.removeAttribute(name); continue }
      const columns = [...box.querySelectorAll('th')].map(th => th.textContent.trim()).filter(Boolean).join(', ')
      box.tabIndex = 0
      box.setAttribute('role', 'region')
      box.setAttribute('aria-label', columns ? 'Table: ' + columns : 'Table')
    }
  }
  const watch = new ResizeObserver(edge)
  for (const box of tables) { watch.observe(box); watch.observe(box.firstElementChild) }
}`
