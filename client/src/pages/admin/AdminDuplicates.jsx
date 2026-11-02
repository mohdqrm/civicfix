// Review queue for AI duplicate suggestions. Nothing is merged automatically.
import { useState } from 'react';
import { useApi } from '../../lib/useApi.js';
import { DuplicateCard } from '../../components/DuplicateCard.jsx';
import { Empty, ErrorState, Loading, Pagination } from '../../components/ui.jsx';

const TABS = [
  ['pending', 'Waiting for review'],
  ['confirmed', 'Confirmed'],
  ['dismissed', 'Dismissed'],
];

export default function AdminDuplicates() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const list = useApi('/admin/duplicates', { query: { status, page, limit: 10 } }, [status, page]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Possible duplicates</h1>
          <p className="muted">
            CivicFix compares each new report with nearby reports from the last 30 days, using wording, distance, category and timing. You decide
            whether they’re the same problem.
          </p>
        </div>
      </div>
      <div className="chips" role="group" aria-label="Show" style={{ marginBottom: 18 }}>
        {TABS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className="chip"
            aria-pressed={status === v}
            onClick={() => {
              setStatus(v);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {list.loading && !list.data && <Loading />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data &&
        (list.data.items.length ? (
          <div style={{ maxWidth: 820 }}>
            {list.data.items.map((s) => (
              <DuplicateCard key={s.id} s={s} onReviewed={() => list.reload()} />
            ))}
            <Pagination page={list.data.page} totalPages={list.data.totalPages} onPage={setPage} />
          </div>
        ) : (
          <Empty title={status === 'pending' ? 'Nothing to review' : `No ${status} suggestions yet`}>
            {status === 'pending' ? 'New possible duplicates will appear here as reports come in.' : null}
          </Empty>
        ))}
    </>
  );
}
