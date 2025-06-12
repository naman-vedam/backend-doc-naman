// Update your existing meeting API
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { MeetingData } from '@/types/meeting.types'

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
      // Add attendees if provided
      attendees: meetingData.attendees?.map(email => ({ email })) || [],
    }

    // Insert the event
    const { data: createdEvent } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      conferenceDataVersion: 1,
    })

    const meetLink =
      createdEvent.conferenceData?.entryPoints?.find(
        (ep) => ep.entryPointType === 'video'
      )?.uri || createdEvent.hangoutLink

    // Store meeting info for later recording retrieval
    const meetingInfo = {
      id: createdEvent.id,
      title: createdEvent.summary,
      startTime: createdEvent.start?.dateTime,
      endTime: createdEvent.end?.dateTime,
      meetLink,
      calendarLink: createdEvent.htmlLink,
      recordingInstructions: {
        message: "To enable recording, click 'Record meeting' when the meeting starts",
        downloadEndpoint: "/api/recordings/download",
        listEndpoint: "/api/recordings/list"
      }
    }

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