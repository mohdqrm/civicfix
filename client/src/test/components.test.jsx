import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { validateRegistration } from '../pages/Auth.jsx';
import { validateReport } from '../pages/Report.jsx';
import { StatusRoad, HistoryList } from '../components/StatusRoad.jsx';
import { StatusBadge, Ticket, Pagination, Field } from '../components/ui.jsx';
import { ComplaintRows } from '../components/ComplaintRows.jsx';

describe('registration validation (mirrors the server rules)', () => {
  const ok = { name: 'Asha', email: 'asha@example.com', password: 'abc12345', confirm: 'abc12345' };
  it('accepts a valid form', () => expect(validateRegistration(ok)).toEqual({}));
  it('flags each problem', () => {
    expect(Object.keys(validateRegistration({ name: 'A', email: 'nope', password: 'short', confirm: 'x' })).sort()).toEqual([
      'confirm',
      'email',
      'name',
      'password',
    ]);
    expect(validateRegistration({ ...ok, password: 'lettersonly', confirm: 'lettersonly' }).password).toMatch(/number/);
  });
});

describe('report validation', () => {
  const photo = (type = 'image/jpeg', size = 1000) => ({ type, size });
  const ok = { categoryId: '1', title: 'Pothole here', description: 'A deep pothole in the lane.', location: { lat: 1, lng: 2 }, photo: photo() };
  it('accepts a complete report', () => expect(validateReport(ok)).toEqual({}));
  it('requires category, location and photo', () => {
    const e = validateReport({ ...ok, categoryId: '', location: null, photo: null });
    expect(Object.keys(e).sort()).toEqual(['categoryId', 'location', 'photo']);
  });
  it('rejects wrong photo types and photos over 5 MB', () => {
    expect(validateReport({ ...ok, photo: photo('image/gif') }).photo).toMatch(/JPEG/);
    expect(validateReport({ ...ok, photo: photo('image/jpeg', 6 * 1024 * 1024) }).photo).toMatch(/5 MB/);
  });
  it('enforces title and description lengths', () => {
    expect(validateReport({ ...ok, title: 'Hi' }).title).toBeDefined();
    expect(validateReport({ ...ok, description: 'x'.repeat(2001) }).description).toBeDefined();
  });
});

const history = [
  { id: 1, fromStatus: null, toStatus: 'submitted', at: '2026-10-01T10:00:00Z', changedBy: 'Reporter', note: 'Complaint submitted' },
  { id: 2, fromStatus: 'submitted', toStatus: 'under_review', at: '2026-10-02T10:00:00Z', changedBy: 'CivicFix team', note: null },
];

describe('StatusRoad', () => {
  it('marks passed stops done and the current stop as the current step', () => {
    const { container } = render(<StatusRoad status="under_review" history={history} />);
    expect(container.querySelectorAll('.road-stop.done')).toHaveLength(1);
    const current = container.querySelector('[aria-current="step"]');
    expect(current).toHaveTextContent('Under review');
  });
  it('shows every stop as done once resolved', () => {
    const { container } = render(<StatusRoad status="resolved" history={history} />);
    expect(container.querySelectorAll('.road-stop.done')).toHaveLength(4);
  });
  it('explains where a rejected complaint stopped', () => {
    render(<StatusRoad status="rejected" history={[...history, { id: 3, fromStatus: 'under_review', toStatus: 'rejected', at: '2026-10-03T00:00:00Z', changedBy: 'CivicFix team' }]} />);
    expect(screen.getByText('Rejected after under review.')).toBeInTheDocument();
  });
  it('history lists each change with who made it and the note', () => {
    render(<HistoryList history={history} />);
    expect(screen.getByText('Submitted → Under review')).toBeInTheDocument();
    expect(screen.getByText(/by CivicFix team/)).toBeInTheDocument();
    expect(screen.getByText('Complaint submitted')).toBeInTheDocument();
  });
});

describe('small components', () => {
  it('StatusBadge shows the human label', () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText('In progress')).toHaveClass('badge', 'in_progress');
  });
  it('Ticket exposes the tracking ID to screen readers', () => {
    render(<Ticket complaint={{ trackingId: 'CF-000042', createdAt: '2026-10-01T00:00:00Z' }} />);
    expect(screen.getByRole('group', { name: 'Tracking ID CF-000042' })).toBeInTheDocument();
  });
  it('Pagination is hidden for a single page and disables the ends', () => {
    const { container, rerender } = render(<Pagination page={1} totalPages={1} onPage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Pagination page={1} totalPages={3} onPage={() => {}} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
  it('Field links its label, hint and error to the input', () => {
    render(<Field label="Title" hint="Short summary" error="Too short">{(p) => <input {...p} />}</Field>);
    const input = screen.getByLabelText('Title');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Short summary Too short');
  });
  it('ComplaintRows links each complaint and never shows reporter info', () => {
    const c = {
      id: 7, trackingId: 'CF-000007', title: 'Broken bench', category: { name: 'Public Infrastructure' }, status: 'rejected',
      createdAt: new Date().toISOString(), imageUrl: null, landmark: 'Central Park', isMine: true,
    };
    render(<MemoryRouter><ComplaintRows items={[c]} /></MemoryRouter>);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/issues/7');
    expect(screen.getByText('Your report')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });
});
