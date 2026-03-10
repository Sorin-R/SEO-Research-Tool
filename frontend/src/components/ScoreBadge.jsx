export default function ScoreBadge({ score, label, size = 'md' }) {
  let color;
  if (score >= 80) color = 'bg-green-100 text-green-800 border-green-300';
  else if (score >= 60) color = 'bg-yellow-100 text-yellow-800 border-yellow-300';
  else if (score >= 40) color = 'bg-orange-100 text-orange-800 border-orange-300';
  else color = 'bg-red-100 text-red-800 border-red-300';

  const sizeClasses = size === 'lg'
    ? 'w-20 h-20 text-2xl'
    : 'w-14 h-14 text-lg';

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`${sizeClasses} ${color} border-2 rounded-full flex items-center justify-center font-bold`}
      >
        {score}
      </div>
      {label && <span className="text-xs text-gray-500">{label}</span>}
    </div>
  );
}
