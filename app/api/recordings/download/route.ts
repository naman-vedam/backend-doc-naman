// app/api/recordings/download/route.ts
import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import fs from 'fs'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || !session.accessToken) {
      return NextResponse.json(
        { error: 'Unauthorized - Sign in again to grant Drive access' },
        { status: 401 }
      )
    }

    const { meetingTitle, recordingDate } = await request.json()

    // Initialize Google API clients
    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: session.accessToken })

    const drive = google.drive({ version: 'v3', auth })

    // Search for meeting recordings in Google Drive
    // Google Meet recordings are typically saved with the meeting name
    const searchQuery = `name contains "${meetingTitle}" and mimeType contains "video/" and trashed=false`
    
    console.log('🔍 Searching for recordings with query:', searchQuery)

    const { data: files } = await drive.files.list({
      q: searchQuery,
      fields: 'files(id, name, mimeType, createdTime, size)',
      orderBy: 'createdTime desc'
    })

    if (!files.files || files.files.length === 0) {
      return NextResponse.json(
        { error: 'No recordings found for this meeting' },
        { status: 404 }
      )
    }

    // Get the most recent recording
    const recording = files.files[0]
    console.log('📹 Found recording:', recording.name)

    // Create downloads directory if it doesn't exist
    const downloadsDir = path.join(process.cwd(), 'downloads')
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true })
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `${meetingTitle.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.mp4`
    const filePath = path.join(downloadsDir, fileName)

    // Download the file
    console.log('⬇️ Downloading recording...')
    
    const response = await drive.files.get({
      fileId: recording.id!,
      alt: 'media'
    }, { responseType: 'stream' })

    // Save file to local directory
    const writer = fs.createWriteStream(filePath)
    response.data.pipe(writer)

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('✅ Recording downloaded successfully:', filePath)
        resolve(NextResponse.json({
          success: true,
          message: 'Recording downloaded successfully',
          fileName: fileName,
          filePath: filePath,
          fileSize: recording.size,
          recordingInfo: {
            id: recording.id,
            name: recording.name,
            createdTime: recording.createdTime
          }
        }))
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