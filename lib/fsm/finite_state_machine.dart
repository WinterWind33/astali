// Copyright (C) 2023 Andrea Ballestrazzi

class FiniteStateMachine<SymbolType> {
  FiniteStateMachine(Set<SymbolType> alphabet)
    : _alphabet = alphabet;

  // === Getters ===

  Set<SymbolType> getAlphabet() {
    return _alphabet;
  }

  // ==== PRIVATE ====

  final Set<SymbolType> _alphabet;
}