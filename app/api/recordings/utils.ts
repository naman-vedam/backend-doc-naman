import { google } from 'googleapis'

export async function getCalendarEventDetails(accessToken: string, eventId: string) {
  try {
    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: accessToken })
    
    const calendar = google.calendar({ version: 'v3', auth })
    
    const { data: event } = await calendar.events.get({
      calendarId: 'primary',
      eventId: eventId
    })
    
    return {
      hostEmail: event.organizer?.email,
      hostName: event.organizer?.displayName,
      eventId: event.id,
      title: event.summary,
      startTime: event.start?.dateTime
    }
  } catch (error) {
    console.error('Error fetching calendar event:', error)
    return null
  }
}