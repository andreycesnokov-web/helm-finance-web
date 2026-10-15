import { Navigate, useLocation } from 'react-router-dom'
import { legacyDestination } from '../../lib/routeIntent'
export default function LegacyRedirect({ to }) {
  return <Navigate to={legacyDestination(useLocation(), to)} replace />
}
