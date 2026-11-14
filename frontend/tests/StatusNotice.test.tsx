import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatusNotice } from '../src/StatusNotice';
import type { StateKind } from '../src/contract';
import { request } from './fixtures';

describe('Public status treatment', () => {
  it.each<StateKind>(['loading', 'connecting', 'queued', 'running', 'no_data', 'source_error', 'insufficient_for_test', 'not_implemented', 'not_found', 'invalid_request', 'protocol_error', 'ready'])('renders %s without a chart or substitute observations', kind => {
    const { container } = render(<StatusNotice state={{ kind, warnings: [], request }} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBeTruthy();
    expect(container.querySelector('svg,canvas,table')).toBeNull();
    expect(container.querySelector('[data-state]')?.getAttribute('data-state')).toBe(kind);
  });
  it('does not show a fabricated percent during a queued job', () => {
    render(<StatusNotice state={{ kind: 'queued', warnings: [], startedAt: Date.now() }} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Progress has not been reported.')).toBeTruthy();
  });
  it('shows an actual reported zero of a positive total', () => {
    render(<StatusNotice state={{ kind: 'running', warnings: [], progress: { done: 0, total: 10, unit: 'months' } }} />);
    expect(screen.getByText('0 of 10 months completed')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('0');
  });
  it('retains the available-result heading alongside a product boundary', () => {
    render(<StatusNotice state={{ kind: 'ready', warnings: [{ code: 'product_boundary_in_period', date: '2011-01' }] }} />);
    expect(screen.getByRole('heading').textContent).toBe('Observations received.');
    expect(screen.getByLabelText('Product boundary')).toBeTruthy();
  });
  it('retries only when the user asks, and does not claim a source failure is a cold start', () => {
    const retry = vi.fn();
    render(<StatusNotice state={{ kind: 'source_error', reason: 'service_unavailable', warnings: [] }} onRetry={retry} />);
    expect(retry).not.toHaveBeenCalled();
    expect(screen.getByRole('heading').textContent).toBe('Could not reach the analysis service.');
    fireEvent.click(screen.getByRole('button', { name: /retry request/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
