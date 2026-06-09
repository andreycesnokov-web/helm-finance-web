import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, fmtFull, daysUntil } from '../lib/api'
import { RightPanel } from '../App'

const SCOPE_LABELS = { all: 'All', business: 'Business', personal: 'Personal' }
const STATUS = {
  healthy:   { bg: '#16A34A', label: 'Healthy' },
  attention: { bg: '#D97706', label: 'Attention' },
  critical:  { bg: '#E24B4A', label: 'Critical' },
}
const getPill = (type) => ({
  payable:    { bg: '#FCEBEB', color: '#A32D2D', text: 'Payable' },
  receivable: { bg: '#EAF3DE', color: '#3B6D11', text: 'Receivable' },
  reminder:   { bg: '#FAEEDA', color: '#633806', text: 'Reminder' },
}[type] || { bg: '#F3F4F6', color: '#6B7280', text: type })
