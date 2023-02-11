// Copyright (C) 2023 Andrea Ballestrazzi

/// Represents the interface of a finite state machine
/// state. The state is represented by a name that
/// has SymbolType as data type.
abstract class FSMState<SymbolType> {

  /// Retrieves the name of this state
  SymbolType getStateName();

  /// Called when performing a transition to this state.
  void onStateEnter();

  /// Called when performing a transition from thi state
  /// to another.
  void onStateLeave();
}

/// Represent an invalid state that is used to signal
/// the parent FSM state that it will enter the initial state
/// after the FSM initialization.
class DeferredInitializationFSMState<SymbolType> implements FSMState<SymbolType> {
  @override
  SymbolType getStateName() {
    throw UnimplementedError();
  }

  @override
  void onStateEnter() {}

  @override
  void onStateLeave() {}
}
