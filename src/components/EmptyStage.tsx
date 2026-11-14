import type { ReactNode } from 'react';
import { useNextAction } from './nextAction';

/** An empty step is an invitation: say what goes here and offer the button that fills it. */
export function EmptyStage({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  const { primary } = useNextAction();
  return <div className="viewport empty-state">
    <div className="empty-card">
      <h2>{title}</h2>
      <p>{children}</p>
      <div className="empty-actions">
        <button type="button" className="btn primary" onClick={primary.run}>{primary.label}</button>
        {extra}
      </div>
    </div>
  </div>;
}
