// Copyright (C) 2023 Andrea Ballestrazzi

import 'fsm_state.dart';

class FiniteStateMachine<SymbolType> {
  FiniteStateMachine(Set<SymbolType> alphabet, FSMState initialState):
    _alphabet = alphabet,
    _currentState = initialState;

  // === Getters ===

  Set<SymbolType> getAlphabet() {
    return _alphabet;
  }

  SymbolType getCurrentStateName() {
    return _currentState.getStateName();
  }

  // ==== PRIVATE ====

  final Set<SymbolType> _alphabet;
  FSMState _currentState;
}

/// Checks wheter or not the given finite state machine is in the state
/// represented by StateName.
bool isInState<SymbolType>(final FiniteStateMachine<SymbolType> fsm, final SymbolType stateName) {
  return fsm.getCurrentStateName() == stateName;
}