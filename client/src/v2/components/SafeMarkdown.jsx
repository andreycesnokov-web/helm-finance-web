import React from 'react'

/**
 * Safe markdown inline parser:
 * Formats **bold**, *italic*, `code`, and links (http / https) without dangerouslySetInnerHTML.
 */
function renderInline(text, keyPrefix = 'inline') {
  if (!text) return null
  // Match tokens: `code`, **bold**, *italic*, http(s) URL
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s<>)"]+)/g
  const parts = text.split(tokenRegex)

  return parts.map((part, idx) => {
    const k = `${keyPrefix}-${idx}`
    if (!part) return null

    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return <code key={k} className="v2-acct-code">{part.slice(1, -1)}</code>
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return <strong key={k}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return <em key={k}>{part.slice(1, -1)}</em>
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={k}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="v2-acct-link"
        >
          {part}
        </a>
      )
    }
    return <span key={k}>{part}</span>
  })
}

/**
 * Safe block-level Markdown renderer:
 * Parses headings (###, ##, #), bullet lists (-, *, •), ordered lists (1., 2.), and paragraphs.
 * Zero use of dangerouslySetInnerHTML.
 */
export default function SafeMarkdown({ content, className = '' }) {
  if (!content) return null

  const lines = String(content).replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let currentList = null // { type: 'ul' | 'ol', items: [] }

  const flushList = () => {
    if (currentList) {
      if (currentList.type === 'ul') {
        blocks.push({
          type: 'ul',
          items: currentList.items,
        })
      } else {
        blocks.push({
          type: 'ol',
          items: currentList.items,
        })
      }
      currentList = null
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    if (!trimmed) {
      flushList()
      continue
    }

    // Heading 3
    if (trimmed.startsWith('### ')) {
      flushList()
      blocks.push({ type: 'h3', text: trimmed.slice(4).trim() })
      continue
    }

    // Heading 2
    if (trimmed.startsWith('## ')) {
      flushList()
      blocks.push({ type: 'h2', text: trimmed.slice(3).trim() })
      continue
    }

    // Heading 1
    if (trimmed.startsWith('# ')) {
      flushList()
      blocks.push({ type: 'h1', text: trimmed.slice(2).trim() })
      continue
    }

    // Unordered bullet list: *, -, •
    const bulletMatch = trimmed.match(/^([-*•])\s+(.+)$/)
    if (bulletMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList()
        currentList = { type: 'ul', items: [] }
      }
      currentList.items.push(bulletMatch[2])
      continue
    }

    // Ordered list: 1. 2. etc
    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/)
    if (numMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList()
        currentList = { type: 'ol', items: [] }
      }
      currentList.items.push(numMatch[2])
      continue
    }

    // Regular paragraph
    flushList()
    blocks.push({ type: 'p', text: trimmed })
  }

  flushList()

  return (
    <div className={`v2-acct-markdown ${className}`}>
      {blocks.map((block, idx) => {
        const key = `block-${idx}`
        switch (block.type) {
          case 'h1':
            return <h3 key={key} className="v2-acct-md-h1">{renderInline(block.text, key)}</h3>
          case 'h2':
            return <h4 key={key} className="v2-acct-md-h2">{renderInline(block.text, key)}</h4>
          case 'h3':
            return <h5 key={key} className="v2-acct-md-h3">{renderInline(block.text, key)}</h5>
          case 'ul':
            return (
              <ul key={key} className="v2-acct-md-ul">
                {block.items.map((itemText, itemIdx) => (
                  <li key={`${key}-item-${itemIdx}`}>{renderInline(itemText, `${key}-item-${itemIdx}`)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={key} className="v2-acct-md-ol">
                {block.items.map((itemText, itemIdx) => (
                  <li key={`${key}-item-${itemIdx}`}>{renderInline(itemText, `${key}-item-${itemIdx}`)}</li>
                ))}
              </ol>
            )
          case 'p':
          default:
            return <p key={key} className="v2-acct-md-p">{renderInline(block.text, key)}</p>
        }
      })}
    </div>
  )
}
