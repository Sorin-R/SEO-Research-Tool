export default function LoadingSpinner({ message = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-500">
      <div className="w-10 h-10 border-4 border-gray-200 border-t-indigo-600 rounded-full animate-spin mb-4" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
