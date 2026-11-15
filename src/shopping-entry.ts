import './shopping-entry.css'
export function shoppingEntry(escapedText:string,busy=false) {
  return `<form id="ai" class="ai shopping-entry" aria-busy="${busy}">
    <label class="sr-only" for="shopping-text">What are you shopping for?</label>
    <textarea id="shopping-text" name="shopping" required maxlength="2500" rows="1" placeholder="What are you shopping for?">${escapedText}</textarea>
    <button type="submit" class="primary" ${busy?'disabled':''}>${busy?'Reading your list…':'Find products for me'} <span aria-hidden="true">→</span></button>
  </form>`
}
