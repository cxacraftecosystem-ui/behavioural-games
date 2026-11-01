// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionGroup, actionGroupLayout } from './action-group';
import { Button } from './button';

afterEach(cleanup);

describe('actionGroupLayout', () => {
  it('centres one, pairs two, stacks three or more', () => {
    expect(actionGroupLayout(0)).toBe('none');
    expect(actionGroupLayout(1)).toBe('single');
    expect(actionGroupLayout(2)).toBe('pair');
    expect(actionGroupLayout(3)).toBe('stack');
    expect(actionGroupLayout(7)).toBe('stack');
  });
});

describe('ActionGroup', () => {
  it('renders only the children that render, looking through fragments', () => {
    const hidden = false;
    render(
      <ActionGroup>
        <>
          <Button>One</Button>
          {hidden && <Button>Hidden</Button>}
        </>
        {null}
        <Button>Two</Button>
      </ActionGroup>,
    );
    const group = screen.getByRole('button', { name: 'One' }).parentElement;
    expect(group?.dataset.slot).toBe('action-group');
    expect(group?.children).toHaveLength(2);
  });

  it('orders a destructive action last and marks it', () => {
    render(
      <ActionGroup>
        <Button variant="destructive">Delete</Button>
        <Button variant="outline">Cancel</Button>
        <Button>Save</Button>
      </ActionGroup>,
    );
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Cancel', 'Save', 'Delete']);
    expect(screen.getByRole('button', { name: 'Delete' }).hasAttribute('data-danger')).toBe(true);
  });

  it('carries the three layouts as CSS on the rendered children', () => {
    render(
      <ActionGroup align="end">
        <Button>Only</Button>
      </ActionGroup>,
    );
    const cls = screen.getByRole('button', { name: 'Only' }).parentElement?.className ?? '';
    expect(cls).toContain('justify-center');
    expect(cls).toContain('max-sm:has-[>:nth-child(2):last-child]:grid-cols-2');
    expect(cls).toContain('max-sm:has-[>:nth-child(3)]:flex-col');
    expect(cls).toContain('sm:has-[>:nth-child(3)]:[&>*]:rounded-full');
    expect(cls).toContain('sm:has-[>:nth-child(2)]:justify-end');
  });

  it('renders nothing without children', () => {
    const { container } = render(<ActionGroup>{false}</ActionGroup>);
    expect(container.innerHTML).toBe('');
  });
});
