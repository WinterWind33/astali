// Copyright (c) 2023 Andrea Ballestrazzi

// System under test
import 'package:astali/fsm/finite_state_machine.dart';

// SUT Dependencies
import 'package:astali/fsm/fsm_state.dart';
import 'package:astali/fsm/fsm_transition.dart';

// Test doubles
import 'finite_state_machine.tests.mocks.dart';

// Test core and engine
import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';

typedef DummySymbolType = int;
const DummySymbolType dummyInitialStateName = 0;
const DummySymbolType dummyFinalStateName = 1;

@GenerateNiceMocks([
  MockSpec<FSMState<DummySymbolType>>(),
  MockSpec<FSMTransition<DummySymbolType>>(),
  MockSpec<FiniteStateMachine<DummySymbolType>>()
])
void main() {
  group("NonDeterministicFSM", () {
    test("Should enter the initial state when instanced", () {
      var initialStateMock = MockFSMState();

      NonDeterministicFSM fsmUnderTest = NonDeterministicFSM(initialStateMock);
      verify(initialStateMock.onStateEnter()).called(1);
    });

    test("Should correclty execute the transition when requested", () {
      var initialStateMock = MockFSMState();
      var transitionMock = MockFSMTransition();

      NonDeterministicFSM fsmUnderTest = NonDeterministicFSM(initialStateMock);
      fsmUnderTest.transit(transitionMock, dummyFinalStateName);

      verify(transitionMock.execute(initialStateMock, dummyFinalStateName))
          .called(1);
    });

    group("When transitioning to a state different from the initial one", () {
      test("It should correctly retrieve the current state name", () {
        var initialStateMock = MockFSMState();
        var finalStateMock = MockFSMState();
        var transitionMock = MockFSMTransition();

        when(transitionMock.execute(initialStateMock, dummyFinalStateName))
            .thenReturn(finalStateMock);
        when(finalStateMock.getStateName()).thenReturn(dummyFinalStateName);

        NonDeterministicFSM fsmUnderTest =
            NonDeterministicFSM(initialStateMock);
        fsmUnderTest.transit(transitionMock, dummyFinalStateName);

        expect(fsmUnderTest.getCurrentStateName(), dummyFinalStateName);
      });
    });
  });

  group("Utility queries", () {
    test("isInState() function should be true when the FSM is in that state",
        () {
      var fsmMock = MockFiniteStateMachine();
      when(fsmMock.getCurrentStateName()).thenReturn(dummyInitialStateName);

      expect(isInState(fsmMock, dummyInitialStateName), true);
    });

    test(
        "isInState() function should be false when the FSM isn't in that state",
        () {
      var fsmMock = MockFiniteStateMachine();
      when(fsmMock.getCurrentStateName()).thenReturn(dummyInitialStateName);

      expect(isInState(fsmMock, dummyFinalStateName), false);
    });
  });
}
