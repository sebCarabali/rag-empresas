import { Suspense } from 'react';
import { QualityView } from '@/components/quality-view';
import { Spinner } from '@/components/ui';

export default function QualityPage() {
  return (
    <Suspense fallback={<div className="p-6"><Spinner /></div>}>
      <QualityView />
    </Suspense>
  );
}
