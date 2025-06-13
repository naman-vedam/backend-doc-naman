// app/api/meet/create/route.ts
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'

interface MeetingData {
  id: string
  title: string
  description?: string
  startTime: string
  endTime: string
  timeZone: string
  attendees?: string[]
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || !session.accessToken) {
      return NextResponse.json(
        { error: 'Unauthorized - Sign in again to grant calendar access' },
        { status: 401 }
      )
    }

    const meetingData: MeetingData = await request.json()

    // Initialize Google API client with OAuth
    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: session.accessToken })

    const calendar = google.calendar({ version: 'v3', auth })

    // Construct the calendar event with Meet link
    const event = {
      summary: meetingData.title,
      description: `${meetingData.description || ''}\n\n🎥 Recording will be available after the meeting ends. Use the recording download feature to get it automatically.`,
      start: {
        dateTime: meetingData.startTime,
        timeZone: meetingData.timeZone,
      },
      end: {
        dateTime: meetingData.endTime,
        timeZone: meetingData.timeZone,
      },
      conferenceData: {
        createRequest: {
          requestId: `meet-${meetingData.id}-${Date.now()}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      },
      // Add attendees - i am not using for now
      attendees: meetingData.attendees?.map(email => ({ email })) || [],
    }

    // Insert the event
    const { data: createdEvent } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      conferenceDataVersion: 1,
    })
    console.log("naman cal",calendar.events)
    const meetLink =
      createdEvent.conferenceData?.entryPoints?.find(
        (ep) => ep.entryPointType === 'video'
      )?.uri || createdEvent.hangoutLink

    // Extracting Meet ID from the meet link
    const meetId = meetLink ? extractMeetIdFromUrl(meetLink) : null

    // Storing meeting info 
    const meetingInfo = {
      id: createdEvent.id, // event ID 
      title: createdEvent.summary,
      startTime: createdEvent.start?.dateTime,
      endTime: createdEvent.end?.dateTime,
      meetLink,
      meetId, 
      calendarLink: createdEvent.htmlLink,
      hostEmail: session.user?.email, // From auth session
      calendarEventId: createdEvent.id, 
      recordingInstructions: {
        message: "To enable recording, click 'Record meeting' when the meeting starts",
        downloadEndpoint: "/api/recordings/download",
        listEndpoint: "/api/recordings/list"
      }
    }

    console.log('✅ Meeting created successfully:', {
      eventId: createdEvent.id,
      meetId: meetId,
      hostEmail: session.user?.email
    })
    console.log("naman",createdEvent)
    return NextResponse.json({
      success: true,
      event: meetingInfo,
    })
  } catch (error) {
    console.error('💥 Error using Calendar SDK:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error },
      { status: 500 }
    )
  }
}

// this is the function to extract Meet ID from Google Meet URL

function extractMeetIdFromUrl(meetUrl: string): string | null {
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
