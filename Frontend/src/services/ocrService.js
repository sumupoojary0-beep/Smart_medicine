import axios from 'axios'

const OCR_API_BASE_URL =
  import.meta.env.VITE_OCR_API_BASE_URL ||
  'http://127.0.0.1:8001/api/v1'

const OCR_TIMEOUT_MS = 600000

const ocrClient = axios.create({
  baseURL: OCR_API_BASE_URL,
  timeout: OCR_TIMEOUT_MS,
  headers: {
    Accept: 'application/json',
  },
})

const getErrorMessage = (error) => {
  if (
    error?.code === 'ECONNABORTED' ||
    error?.code === 'ETIMEDOUT'
  ) {
    return (
      'The prescription scan exceeded ten minutes. ' +
      'Check the OCR terminal before trying again.'
    )
  }

  if (!error?.response) {
    return (
      'The OCR service could not be reached. ' +
      'Make sure it is running on port 8001.'
    )
  }

  const detail = error.response?.data?.detail

  if (typeof detail === 'string') {
    return detail
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => item?.msg || String(item))
      .join(', ')
  }

  return (
    error.response?.data?.message ||
    `OCR request failed with status ${error.response.status}.`
  )
}

const scanPrescription = async (file) => {
  if (!(file instanceof File)) {
    throw new Error(
      'Please select a valid prescription image.',
    )
  }

  const formData = new FormData()
  formData.append('file', file)

  try {
    const response = await ocrClient.post(
      '/ocr/prescription',
      formData,
      {
        timeout: OCR_TIMEOUT_MS,
      },
    )

    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

const checkHealth = async () => {
  try {
    const response = await ocrClient.get('/health', {
      timeout: 10000,
    })

    return response.data
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

const ocrService = {
  scanPrescription,
  checkHealth,
}

export default ocrService