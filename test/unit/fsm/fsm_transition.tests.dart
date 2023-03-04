// Copyright (c) 2023 Andrea Ballestrazzi

// System under test
import 'package:astali/fsm/fsm_transition.dart';

// SUT Dependencies
import 'package:astali/fsm/fsm_state.dart';

// Test doubles
import 'fsm_transition.tests.mocks.dart';

// Tests core and engine
import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/annotations.dart';
import 'package:mockito/mockito.dart';

typedef DummySymbolType = int;
const DummySymbolType dummyInitialStateName = 0;
const DummySymbolType dummyFinalStateName = 1;

@GenerateNiceMocks([
  MockSpec<FSMStateResolver<DummySymbolType>>(),
  MockSpec<FSMState<DummySymbolType>>()
])
void main() {
  group("FSMSimpleTransition", () {
    test("Should correctly leave the initial state when transitioning", () {
      var initialStateMock = MockFSMState();
      var finalStateMock = MockFSMState();
      var stateResolverMock = MockFSMStateResolver();

      when(stateResolverMock.getState(dummyFinalStateName))
          .thenReturn(finalStateMock);

      FSMSimpleTransition<DummySymbolType> transitionUnderTest =
          FSMSimpleTransition(stateResolverMock);

      transitionUnderTest.execute(initialStateMock, dummyFinalStateName);
      verify(initialStateMock.onStateLeave()).called(1);
    });

    test("Should correctly enter the final state when transitioning", () {
      var initialStateMock = MockFSMState();
      var finalStateMock = MockFSMState();
      var stateResolverMock = MockFSMStateResolver();

      when(stateResolverMock.getState(dummyFinalStateName))
          .thenReturn(finalStateMock);

      FSMSimpleTransition<DummySymbolType> transitionUnderTest =
          FSMSimpleTransition(stateResolverMock);

      transitionUnderTest.execute(initialStateMock, dummyFinalStateName);
      verify(finalStateMock.onStateEnter()).called(1);
    });

    test("execute() method Should correctly return the final state", () {
      var initialStateMock = MockFSMState();
      var finalStateMock = MockFSMState();
      var stateResolverMock = MockFSMStateResolver();

      when(stateResolverMock.getState(dummyFinalStateName))
          .thenReturn(finalStateMock);

      FSMSimpleTransition<DummySymbolType> transitionUnderTest =
          FSMSimpleTransition(stateResolverMock);

      FSMState<DummySymbolType> result =
          transitionUnderTest.execute(initialStateMock, dummyFinalStateName);
      expect(result, finalStateMock);
    });
  });

  group("FSMTransitionToInitialState", () {
    test("Shouldn't leave the starting state when transitioning", () {
      var initialStateMock = MockFSMState();
      var finalStateMock = MockFSMState();
      var stateResolverMock = MockFSMStateResolver();

      when(stateResolverMock.getState(dummyFinalStateName))
          .thenReturn(finalStateMock);

      FSMTransitionToInitialState transitionUnderTest =
          FSMTransitionToInitialState(stateResolverMock);

      transitionUnderTest.execute(initialStateMock, dummyFinalStateName);

      verifyNever(initialStateMock.onStateLeave());
    });

    test("Should only enter the final state when transitioning", () {
      var initialStateMock = MockFSMState();
      var finalStateMock = MockFSMState();
      var stateResolverMock = MockFSMStateResolver();

      when(stateResolverMock.getState(dummyFinalStateName))
          .thenReturn(finalStateMock);

      FSMTransitionToInitialState transitionUnderTest =
          FSMTransitionToInitialState(stateResolverMock);

      transitionUnderTest.execute(initialStateMock, dummyFinalStateName);

      verify(finalStateMock.onStateEnter()).called(1);
    });
  });
}
