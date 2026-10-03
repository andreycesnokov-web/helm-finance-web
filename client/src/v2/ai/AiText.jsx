// Renders AI text with clickable phrases (lib/aiLinks.js). Links stay in the app.
import { Link } from 'react-router-dom'
import { parseAiText } from '../lib/aiLinks'

export default function AiText({ text, onNavigate }) {
  const segs = parseAiText(text)
  return (
    <>
      {segs.map((s, i) => s.type === 'link'
        ? <Link key={i} to={s.to} className="v2-ailink" title={s.to} onClick={onNavigate}>{s.text}</Link>
        : <span key={i}>{s.text}</span>)}
    </>
  )
}
