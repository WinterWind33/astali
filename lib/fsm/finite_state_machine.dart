// Copyright (C) 2023 Andrea Ballestrazzi

import 'fsm_transition.dart';
import 'fsm_state.dart';

abstract class FiniteStateMachine<SymbolType> {
  SymbolType getCurrentStateName();
}

/// Checks wheter or not the given finite state machine is in the state
/// represented by StateName.
bool isInState<SymbolType>(final FiniteStateMachine<SymbolType> fsm, final SymbolType stateName) {
  return fsm.getCurrentStateName() == stateName;
}

class NonDeterministicFSM<SymbolType> implements FiniteStateMachine<SymbolType> {
  NonDeterministicFSM(FSMState<SymbolType> initialState):
    _currentState = initialState {
      _currentState.onStateEnter();
    }

  void transit(FSMTransition<SymbolType> transition, final SymbolType finalStateName) {
    _currentState = transition.execute(_currentState, finalStateName);
  }

  // === Getters ===

  @override
  SymbolType getCurrentStateName() {
    return _currentState.getStateName();
  }

  // ==== PRIVATE ====

  FSMState<SymbolType> _currentState;
}
