// Copyright (C) 2023 Andrea Ballestrazzi

import 'fsm_state.dart';

abstract class FSMStateResolver<SymbolType> {
  FSMState<SymbolType> getState(final SymbolType stateName);
  Set<SymbolType> getAlphabet();
}


abstract class FSMTransition<SymbolType> {
  FSMState<SymbolType> execute(FSMState<SymbolType> startingState, final SymbolType finalStateName);
}

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
