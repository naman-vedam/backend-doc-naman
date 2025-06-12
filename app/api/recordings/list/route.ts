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

    // Initialize Google API client
    const auth = new google.auth.OAuth2()
    auth.setCredentials({ access_token: session.accessToken })

    const drive = google.drive({ version: 'v3', auth })

    // Search for all video files (potential recordings)
    // Google Meet recordings are typically saved in specific folders
    const searchQuery = `mimeType contains "video/" and trashed=false`

    console.log('🔍 Searching for all video recordings...')

    const { data: files } = await drive.files.list({
      q: searchQuery,
      fields: 'files(id, name, mimeType, createdTime, size, parents)',
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

    // Filter for likely Google Meet recordings
    const recordings = files.files
      .filter(file => 
        file.name?.toLowerCase().includes('meet') || 
        file.name?.toLowerCase().includes('recording') ||
        file.mimeType?.includes('video/mp4')
      )
      .map(file => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        createdTime: file.createdTime,
        size: file.size,
        sizeFormatted: formatFileSize(parseInt(file.size || '0'))
      }))

    console.log(`📹 Found ${recordings.length} potential recordings`)

    return NextResponse.json({
      success: true,
      recordings: recordings,
      total: recordings.length
    })

  } catch (error) {
    console.error('💥 Error listing recordings:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error },
      { status: 500 }
    )
  }
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}