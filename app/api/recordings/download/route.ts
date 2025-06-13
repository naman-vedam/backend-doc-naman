// app/api/recordings/download/route.ts
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import fs from 'fs'
import path from 'path'

// Enhanced filename generation with all required metadata
const generateUniqueFileName = (
  meetingTitle: string, 
  meetingId: string | null, 
  calendarEventId: string | null, 
  hostEmail: string,
  timestamp?: string
) => {
  const dateStr = timestamp ? new Date(timestamp).toISOString().replace(/[:.]/g, '-').split('T')[0] 
                            : new Date().toISOString().replace(/[:.]/g, '-').split('T')[0]
  
  const safeMeetingTitle = meetingTitle.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)
  const hostPart = hostEmail ? `_${hostEmail.split('@')[0]}` : ''
  const eventPart = calendarEventId ? `_${calendarEventId}` : ''
  const meetingPart = meetingId ? `_${meetingId}` : ''
  
  return `${safeMeetingTitle}_${dateStr}${hostPart}${eventPart}${meetingPart}.mp4`
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || !session.accessToken) {
      return NextResponse.json(
        { error: 'Unauthorized - Sign in again to grant Drive access' },
        { status: 401 }
      )
    }

    const { 
      recordingId, 
      meetingTitle, 
      recordingDate, 
      meetingId,
      calendarEventId, // Now properly handled
      hostEmail 
    } = await request.json()

    // Initialize Google API clients
    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: session.accessToken })

    const drive = google.drive({ version: 'v3', auth })
    const calendar = google.calendar({ version: 'v3', auth })

    let recording = null
    let calendarEventDetails = null

    // If we have a specific recording ID, use it directly
    if (recordingId) {
      console.log('📹 Fetching recording by ID:', recordingId)
      
      try {
        const { data } = await drive.files.get({
          fileId: recordingId,
          fields: 'id, name, mimeType, createdTime, size, description, properties'
        })
        recording = data
        console.log('✅ Recording found:', recording.name)
      } catch (error) {
        console.error('❌ Error fetching recording by ID:', error)
        return NextResponse.json(
          { error: 'Recording not found or access denied' },
          { status: 404 }
        )
      }
    } else {
      // Fallback to search method (legacy support)
      const searchQuery = `name contains "${meetingTitle}" and mimeType contains "video/" and trashed=false`
      
      console.log('🔍 Searching for recordings with query:', searchQuery)

      const { data: files } = await drive.files.list({
        q: searchQuery,
        fields: 'files(id, name, mimeType, createdTime, size, description, properties)',
        orderBy: 'createdTime desc'
      })

      if (!files.files || files.files.length === 0) {
        return NextResponse.json(
          { error: 'No recordings found for this meeting' },
          { status: 404 }
        )
      }

      // Get the most recent recording
      recording = files.files[0]
    }

    // If we have a calendar event ID, fetch the event details
    if (calendarEventId) {
      try {
        console.log('📅 Fetching calendar event details:', calendarEventId)
        
        const { data: eventData } = await calendar.events.get({
          calendarId: 'primary',
          eventId: calendarEventId
        })
        
        calendarEventDetails = eventData
        console.log('✅ Calendar event found:', eventData.summary)
      } catch (error) {
        console.warn('⚠️ Could not fetch calendar event details:', error)
        // Continue without calendar details
      }
    }

    // Extract additional metadata from recording
    const extractedMeetingId = extractMeetingIdFromRecording(recording)
    const finalMeetingId = meetingId || extractedMeetingId

    // Use calendar event details if available, otherwise fallback to provided data
    const finalMeetingTitle = calendarEventDetails?.summary || meetingTitle || recording.name || 'Meeting'
    const finalHostEmail = hostEmail || session.user?.email || 'unknown'
    const finalCalendarEventId = calendarEventDetails?.id || calendarEventId

    console.log('📋 Recording metadata:', {
      title: finalMeetingTitle,
      meetingId: finalMeetingId,
      calendarEventId: finalCalendarEventId,
      hostEmail: finalHostEmail,
      recordingCreatedTime: recording.createdTime
    })

    // Create downloads directory if it doesn't exist
    const downloadsDir = path.join(process.cwd(), 'downloads')
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true })
    }

    // Generate comprehensive filename with all metadata
    const fileName = generateUniqueFileName(
      finalMeetingTitle,
      finalMeetingId,
      finalCalendarEventId,
      finalHostEmail,
      recording.createdTime ?? undefined
    )
    
    const filePath = path.join(downloadsDir, fileName)

    // Check if file already exists and create unique name if needed
    let finalFilePath = filePath
    let counter = 1
    while (fs.existsSync(finalFilePath)) {
      const nameWithoutExt = fileName.replace('.mp4', '')
      finalFilePath = path.join(downloadsDir, `${nameWithoutExt}_${counter}.mp4`)
      counter++
    }

    // Download the file
    console.log('⬇️ Downloading recording to:', finalFilePath)
    
    const response = await drive.files.get({
      fileId: recording.id!,
      alt: 'media'
    }, { responseType: 'stream' })

    // Save file to local directory
    const writer = fs.createWriteStream(finalFilePath)
    response.data.pipe(writer)

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('✅ Recording downloaded successfully:', finalFilePath)
        
        // Create comprehensive response with all metadata
        const responseData = {
          success: true,
          message: 'Recording downloaded successfully',
          fileName: path.basename(finalFilePath),
          filePath: finalFilePath,
          fileSize: recording.size,
          recordingInfo: {
            id: recording.id,
            name: recording.name,
            createdTime: recording.createdTime,
            meetingId: finalMeetingId,
            description: recording.description,
            // Calendar event information
            calendarEventId: finalCalendarEventId,
            eventTitle: calendarEventDetails?.summary,
            eventStartTime: calendarEventDetails?.start?.dateTime || calendarEventDetails?.start?.date,
            eventEndTime: calendarEventDetails?.end?.dateTime || calendarEventDetails?.end?.date,
            hostEmail: finalHostEmail,
            // Meeting details
            meetingMetadata: {
              originalTitle: meetingTitle,
              finalTitle: finalMeetingTitle,
              originalMeetingId: meetingId,
              extractedMeetingId: extractedMeetingId,
              finalMeetingId: finalMeetingId,
              timestamp: recording.createdTime
            }
          }
        }

        resolve(NextResponse.json(responseData))
      })

      writer.on('error', (error) => {
        console.error('❌ Error downloading recording:', error)
        reject(NextResponse.json(
          { error: 'Failed to download recording', details: error.message },
          { status: 500 }
        ))
      })
    })

  } catch (error) {
    console.error('💥 Error in recording download:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error },
      { status: 500 }
    )
  }
}

// Helper function to extract meeting ID from recording metadata
function extractMeetingIdFromRecording(recording: any): string | null {
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
  if (recording.name) {
    for (const pattern of patterns) {
      const match = recording.name.match(pattern)
      if (match) return match[1]
    }
  }

  // Check description
  if (recording.description) {
    for (const pattern of patterns) {
      const match = recording.description.match(pattern)
      if (match) return match[1]
    }
  }

  // Check properties (custom metadata)
  if (recording.properties?.meetingId) {
    return recording.properties.meetingId
  }

  return null
}