import { Suspense } from 'react';
import { ProjectView } from '@/components/project-view';
import { Spinner } from '@/components/ui';

export default function ProjectPage() {
  return (
    <Suspense fallback={<div className="p-6"><Spinner /></div>}>
      <ProjectView />
    </Suspense>
  );
}
