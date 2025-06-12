'use client'
import React, { useState, useEffect } from 'react'
import { Download, Video, Calendar, Clock, HardDrive } from 'lucide-react'

interface Recording {
  id: string
  name: string
  mimeType: string
  createdTime: string
  size: string
  sizeFormatted: string
}

const RecordingManager = () => {
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  // Fetch available recordings
  const fetchRecordings = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/recordings/list')
      const data = await response.json()
      
      if (data.success) {
        setRecordings(data.recordings)
        setMessage(`Found ${data.total} recordings`)
      } else {
        setMessage('Failed to fetch recordings')
      }
    } catch (error) {
      setMessage('Error fetching recordings')
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  // Download specific recording
  const downloadRecording = async (recording: Recording) => {
    setDownloading(recording.id)
    try {
      const response = await fetch('/api/recordings/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          meetingTitle: recording.name.replace(/\.[^/.]+$/, ''), // Remove extension
          recordingDate: recording.createdTime
        })
      })

      const data = await response.json()
      
      if (data.success) {
        setMessage(`✅ Recording downloaded: ${data.fileName}`)
      } else {
        setMessage(`❌ Download failed: ${data.error}`)
      }
    } catch (error) {
      setMessage('❌ Error downloading recording')
      console.error('Error:', error)
    } finally {
      setDownloading(null)
    }
  }

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  useEffect(() => {
    fetchRecordings()
  }, [])

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg my-10">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Video className="text-blue-600" />
          Google Meet Recordings
        </h2>
        <button
          onClick={fetchRecordings}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-lg mb-4 ${
          message.includes('✅') ? 'bg-green-100 text-green-800' : 
          message.includes('❌') ? 'bg-red-100 text-red-800' : 
          'bg-blue-100 text-blue-800'
        }`}>
          {message}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading recordings...</p>
        </div>
      ) : recordings.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Video className="mx-auto h-12 w-12 mb-4 opacity-50" />
          <p>No recordings found</p>
          <p className="text-sm mt-2">Record a Google Meet session to see it here</p>
        </div>
      ) : (
        <div className="space-y-4">
          {recordings.map((recording) => (
            <div key={recording.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 mb-2">{recording.name}</h3>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {formatDate(recording.createdTime)}
                    </div>
                    <div className="flex items-center gap-1">
                      <HardDrive className="h-4 w-4" />
                      {recording.sizeFormatted}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => downloadRecording(recording)}
                  disabled={downloading === recording.id}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {downloading === recording.id ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Download
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

        {/* <div className="mt-8 p-4 bg-yellow-50 rounded-lg">
            <h3 className="font-semibold text-yellow-800 mb-2">📝 How to Record Meetings:</h3>
            <ol className="list-decimal list-inside text-sm text-yellow-700 space-y-1">
            <li>Start your Google Meet session</li>
            <li>Click on "Activities" → "Recording" → "Start recording"</li>
            <li>The recording will be saved to your Google Drive automatically</li>
            <li>Use this tool to download recordings to your local folder</li>
            </ol>
        </div> */}
    </div>
  )
}

export default RecordingManager