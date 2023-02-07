// Copyright (C) 2023 Andrea Ballestrazzi

import 'fsm_state.dart';

abstract class FSMStateResolver<SymbolType> {
  FSMState<SymbolType>? getState(final SymbolType stateName);
}


class FSMTransition<SymbolType> {
  FSMTransition(FSMState<SymbolType> startingState, final FSMStateResolver<SymbolType> stateResolver) :
    _startingState = startingState,
    _stateResolver = stateResolver;

  FSMState<SymbolType> execute(final SymbolType finalStateName) {
    FSMState<SymbolType>? finalState = _stateResolver.getState(finalStateName);
    assert(finalState != null);

    _startingState.onStateLeave();
    finalState!.onStateEnter();

    return finalState;
  }

  FSMState<SymbolType> _startingState;
  final FSMStateResolver<SymbolType> _stateResolver;
}