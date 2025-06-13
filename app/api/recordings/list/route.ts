// app/api/recordings/list/route.ts
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || !session.accessToken) {
      return NextResponse.json(
        { error: 'Unauthorized - Sign in again to grant Drive access' },
        { status: 401 }
      )
    }

    // Initialize Google API clients
    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: session.accessToken })

    const drive = google.drive({ version: 'v3', auth })
    const calendar = google.calendar({ version: 'v3', auth })

    // Search for all video files (potential recordings)
    const searchQuery = `mimeType contains "video/" and trashed=false`

    console.log('🔍 Searching for all video recordings...')

    const { data: files } = await drive.files.list({
      q: searchQuery,
      fields: 'files(id, name, mimeType, createdTime, size, parents, description, properties)',
      orderBy: 'createdTime desc',
      pageSize: 50 // Limit to recent recordings
    })

    if (!files.files || files.files.length === 0) {
      return NextResponse.json({
        success: true,
        recordings: [],
        message: 'No recordings found'
      })
    }

    // Get calendar events for matching
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000))

    console.log('📅 Fetching calendar events for matching...')
    
    const { data: calendarEvents } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: thirtyDaysAgo.toISOString(),
      timeMax: now.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100
    })

    // Function to extract meeting ID from various sources
    const extractMeetingId = (file: any): string | null => {
      const patterns = [
        // Standard Google Meet ID pattern
        /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i,
        // Meeting ID in filename
        /meeting[_-]?id[_:-]?\s*([a-z]{3}-[a-z]{4}-[a-z]{3})/i,
        // Direct pattern match
        /([a-z]{3}-[a-z]{4}-[a-z]{3})/i,
        // Alternative patterns
        /meet[_-]([a-z0-9-]{10,})/i
      ]

      // Check filename
      if (file.name) {
        for (const pattern of patterns) {
          const match = file.name.match(pattern)
          if (match) return match[1]
        }
      }

      // Check description
      if (file.description) {
        for (const pattern of patterns) {
          const match = file.description.match(pattern)
          if (match) return match[1]
        }
      }

      // Check properties (custom metadata)
      if (file.properties?.meetingId) {
        return file.properties.meetingId
      }

      return null
    }

    // Function to match recording with calendar event
    const matchRecordingWithCalendarEvent = (file: any) => {
      const fileCreatedTime = new Date(file.createdTime)
      const meetingId = extractMeetingId(file)
      
      // Try to find matching calendar event
      const matchingEvent = calendarEvents.items?.find(event => {
        if (!event.conferenceData?.entryPoints) return false
        
        const meetLink = event.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video')?.uri
        if (!meetLink) return false
        
        const eventMeetId = extractMeetIdFromUrl(meetLink)
        const eventStartTime = new Date(event.start?.dateTime || event.start?.date || '')
        const eventEndTime = new Date(event.end?.dateTime || event.end?.date || '')
        
        // Match by meeting ID if available
        if (meetingId && eventMeetId && meetingId === eventMeetId) {
          return true
        }
        
        // Match by time proximity (within 4 hours of event time)
        const timeDiff = Math.abs(fileCreatedTime.getTime() - eventStartTime.getTime())
        const fourHours = 4 * 60 * 60 * 1000
        
        if (timeDiff <= fourHours) {
          // Additional checks for better matching
          const fileName = file.name?.toLowerCase() || ''
          const eventTitle = event.summary?.toLowerCase() || ''
          
          // Check if event title words appear in filename
          const titleWords = eventTitle.split(' ').filter(word => word.length > 3)
          const hasMatchingWords = titleWords.some(word => fileName.includes(word))
          
          return hasMatchingWords
        }
        
        return false
      })
      
      return matchingEvent
    }

    // Function to determine if a file is likely a Google Meet recording
    const isLikelyMeetRecording = (file: any): boolean => {
      const name = file.name?.toLowerCase() || ''
      
      return (
        name.includes('meet') || 
        name.includes('recording') ||
        name.includes('google meet') ||
        file.mimeType?.includes('video/mp4') ||
        extractMeetingId(file) !== null
      )
    }

    // Helper function to extract Meet ID from URL
    const extractMeetIdFromUrl = (meetUrl: string): string | null => {
      const patterns = [
        /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i,
        /meet\.google\.com\/lookup\/([^?]+)/i,
      ]

      for (const pattern of patterns) {
        const match = meetUrl.match(pattern)
        if (match) return match[1]
      }

      return null
    }

    // Process and filter recordings
    const recordings = files.files
      .filter(isLikelyMeetRecording)
      .map(file => {
        const meetingId = extractMeetingId(file)
        const matchedEvent = matchRecordingWithCalendarEvent(file)
        
        return {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          createdTime: file.createdTime,
          size: file.size,
          sizeFormatted: formatFileSize(parseInt(file.size || '0')),
          meetingId: meetingId,
          description: file.description,
          // Calendar event information
          calendarEventId: matchedEvent?.id || null,
          eventTitle: matchedEvent?.summary || null,
          eventStartTime: matchedEvent?.start?.dateTime || matchedEvent?.start?.date || null,
          eventEndTime: matchedEvent?.end?.dateTime || matchedEvent?.end?.date || null,
          hostEmail: session.user?.email || null,
          // Additional metadata
          hasMetadata: !!meetingId,
          hasCalendarMatch: !!matchedEvent,
          // Generate proper filename for download
          suggestedFileName: generateRecordingFileName(file, matchedEvent, session.user?.email || '', meetingId)
        }
      })
      // Sort by creation time, then by whether they have calendar match
      .sort((a, b) => {
        // First sort by creation time (newest first)
        const timeSort = new Date(b.createdTime || 0).getTime() - new Date(a.createdTime || 0).getTime()
        if (timeSort !== 0) return timeSort
        
        // Then prioritize recordings with calendar matches
        if (a.hasCalendarMatch && !b.hasCalendarMatch) return -1
        if (!a.hasCalendarMatch && b.hasCalendarMatch) return 1
        
        return 0
      })

    console.log(`📹 Found ${recordings.length} potential recordings`)
    console.log(`🆔 ${recordings.filter(r => r.meetingId).length} recordings have meeting IDs`)
    console.log(`📅 ${recordings.filter(r => r.hasCalendarMatch).length} recordings matched with calendar events`)

    return NextResponse.json({
      success: true,
      recordings: recordings,
      total: recordings.length,
      withMeetingId: recordings.filter(r => r.meetingId).length,
      withCalendarMatch: recordings.filter(r => r.hasCalendarMatch).length
    })

  } catch (error) {
    console.error('💥 Error listing recordings:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error },
      { status: 500 }
    )
  }
}

// Helper function to generate proper recording filename
function generateRecordingFileName(file: any, calendarEvent: any, hostEmail: string, meetingId: string | null): string {
  const createdTime = new Date(file.createdTime || Date.now())
  const timestamp = createdTime.toISOString().replace(/[:.]/g, '-').split('T')[0]
  
  // If we have calendar event info, use it for better naming
  if (calendarEvent) {
    const hostPart = hostEmail ? `_${hostEmail.split('@')[0]}` : ''
    const eventPart = calendarEvent.id ? `_${calendarEvent.id}` : ''
    const meetPart = meetingId ? `_${meetingId}` : ''
    const safeName = (calendarEvent.summary || 'Meeting').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)
    
    return `${safeName}_${timestamp}${hostPart}${eventPart}${meetPart}.mp4`
  }
  
  // Fallback to existing logic
  const titlePart = file.name?.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30) || 'Recording'
  const meetingPart = meetingId ? `_${meetingId}` : ''
  const hostPart = hostEmail ? `_${hostEmail.split('@')[0]}` : ''
  
  return `${titlePart}_${timestamp}${hostPart}${meetingPart}.mp4`
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}