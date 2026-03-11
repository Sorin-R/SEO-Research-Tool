const BASE_ACTION_BUTTON =
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function getActionSizeClass(size = 'sm') {
  return size === 'xs'
    ? 'min-w-[7.75rem] px-3 py-1.5 text-xs'
    : 'min-w-[7.75rem] px-3 py-1.5 text-sm';
}

export function getTrackActionClass(isTracked, size = 'sm') {
  return `${BASE_ACTION_BUTTON} ${getActionSizeClass(size)} ${
    isTracked
      ? 'border-green-200 bg-green-50 text-green-700'
      : 'border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50'
  }`;
}

export function getSaveActionClass(isSaved, size = 'sm') {
  return `${BASE_ACTION_BUTTON} ${getActionSizeClass(size)} ${
    isSaved
      ? 'border-green-200 bg-green-50 text-green-700'
      : 'border-gray-300 bg-white text-gray-700 hover:border-indigo-300 hover:text-indigo-700'
  }`;
}

export function getBulkSaveActionClass(isSaved) {
  return `inline-flex min-w-[11rem] items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
    isSaved
      ? 'border border-green-200 bg-green-50 text-green-700'
      : 'bg-indigo-600 text-white hover:bg-indigo-700'
  } disabled:opacity-50 disabled:cursor-not-allowed`;
}
