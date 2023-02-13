// Copyright (C) 2023 Andrea Ballestrazzi

import 'fsm_state.dart';

/// Represents the basic interface of a state resolver, i.e. an object
/// that, given a symbol name, it retrieves the corresponding FSM state.
abstract class FSMStateResolver<SymbolType> {
  FSMState<SymbolType> getState(final SymbolType stateName);

  /// Retrieves all the names for the states that are supported
  /// by this resolver.
  Set<SymbolType> getAlphabet();
}

/// Represents a transition between two states of a finite state machine
abstract class FSMTransition<SymbolType> {
  FSMState<SymbolType> execute(FSMState<SymbolType> startingState, final SymbolType finalStateName);
}

/// Represents the basic transition between two states:
///  - onStateLeave() called on the starting state;
///  - onStateEnter() called on the final state;
class FSMSimpleTransition<SymbolType> implements FSMTransition<SymbolType> {
  FSMSimpleTransition(final FSMStateResolver<SymbolType> stateResolver) :
    _stateResolver = stateResolver;

  @override
  FSMState<SymbolType> execute(FSMState<SymbolType> startingState, final SymbolType finalStateName) {
    FSMState<SymbolType> finalState = _stateResolver.getState(finalStateName);

    startingState.onStateLeave();
    finalState.onStateEnter();

    return finalState;
  }

  final FSMStateResolver<SymbolType> _stateResolver;
}

/// Represents a particular transition between and invalid starting state (typically a
/// deferred initialization satte) and the first valid state of a FSM.
class FSMTransitionToInitialState<SymbolType> implements FSMTransition<SymbolType> {
  const FSMTransitionToInitialState(final FSMStateResolver<SymbolType> stateResolver) :
    _stateResolver = stateResolver;

  @override
  FSMState<SymbolType> execute(FSMState<SymbolType> startingState, final SymbolType finalStateName) {
    FSMState<SymbolType> finalState = _stateResolver.getState(finalStateName);

    // Here we don't call onStateLeave() because the previous state
    // is an invalid state (like a deferred state).
    finalState.onStateEnter();

    return finalState;
  }

  final FSMStateResolver<SymbolType> _stateResolver;
}
