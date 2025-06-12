// types/meeting.types.ts
export interface MeetingData {
  id: string
  title: string
  description?: string
  startTime: string
  endTime: string
  timeZone: string
  attendees?: string[]
}

export interface Recording {
  id: string
  name: string
  mimeType: string
  createdTime: string
  size: string
  sizeFormatted: string
}

export interface RecordingDownloadResponse {
  success: boolean
  message?: string
  fileName?: string
  filePath?: string
  fileSize?: string
  recordingInfo?: {
    id: string
    name: string
    createdTime: string
  }
  error?: string
}

export interface RecordingListResponse {
  success: boolean
  recordings: Recording[]
  total: number
  message?: string
  error?: string
}