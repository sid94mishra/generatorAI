// MB-34 ReviewCard: the decision row, the feedback rule, the risky (signed) states.
import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';

import { renderThemed } from '../../ui/__tests__/themed';
import { ReviewCard } from './ReviewCard';
import { reviewView } from './model/reviewModel';

const view = reviewView({ name: 'Apply upgrades', stageKey: 'apply', interruptData: { round: 1, summary: '14 packages, 3 majors' } }, { maxRounds: 3 });
const ready = { risky: true, readiness: 'ok' as const, noun: 'Face ID', onRegister: jest.fn(), registering: false, error: null };

describe('ReviewCard (MB-34)', () => {
  it('approves through the signed path and says what it needs', async () => {
    const onDecide = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderThemed(<ReviewCard view={view} onDecide={onDecide} approval={ready} agent="Bug Fixer" />);
    expect(screen.getByText('14 packages, 3 majors')).toBeTruthy();
    expect(screen.getByText('Face ID required')).toBeTruthy();
    await user.press(screen.getByTestId('review-approve'));
    expect(onDecide).toHaveBeenCalledWith('approved', undefined);
  });

  it('sends changes only with feedback', async () => {
    const onDecide = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderThemed(<ReviewCard view={view} onDecide={onDecide} approval={ready} />);
    await user.press(screen.getByTestId('review-changes'));
    expect(onDecide).not.toHaveBeenCalled();
    await user.type(screen.getByTestId('review-feedback'), 'Pin express to 4');
    await user.press(screen.getByTestId('review-changes'));
    expect(onDecide).toHaveBeenCalledWith('changes_requested', 'Pin express to 4');
  });

  it('asks for the approval key first, and opens the sheet when compact', async () => {
    const onRegister = jest.fn();
    const onReview = jest.fn();
    const user = userEvent.setup();
    const { unmount } = await renderThemed(<ReviewCard view={view} onDecide={jest.fn()} approval={{ ...ready, readiness: 'missing', onRegister }} />);
    await user.press(screen.getByTestId('review-register'));
    expect(onRegister).toHaveBeenCalled();
    unmount();
    await renderThemed(<ReviewCard view={view} onReview={onReview} />);
    await user.press(screen.getByTestId('review-card-open'));
    expect(onReview).toHaveBeenCalled();
  });
});
