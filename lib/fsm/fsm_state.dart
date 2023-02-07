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