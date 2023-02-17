// Copyright (c) 2023 Andrea Ballestrazzi

import 'bulletin_board_card_id.dart';

typedef BulletinBoardCardSelectionSet = Set<BulletinBoardCardID>;

typedef OnBulletinBoardCardSelectionChangedEvent = void Function(
    BulletinBoardCardID, bool);

class BulletinBoardCardSelectionLock {
  const BulletinBoardCardSelectionLock(final bool bLocked)
      : _bIsSelectionLocked = bLocked;

  bool isSelectionLocked() {
    return _bIsSelectionLocked;
  }

  static void sink(BulletinBoardCardSelectionLock lock) {
    lock = const BulletinBoardCardSelectionLock(false);
  }

  final bool _bIsSelectionLocked;
}

abstract class BulletinBoardCardSafeSelectionController {
  BulletinBoardCardSelectionSet getSelectedCardsIDs();

  void safeSetCardSelectionState(
      final BulletinBoardCardID cardID, final bool bSelected);

  void safeSetCardSelectionStateAndLock(
      final BulletinBoardCardID cardID, final bool bSelected);

  void safeSetCardSelectionStateOrSinkLock(
      final BulletinBoardCardID cardID, final bool bSelected);
}

class BulletinBoardCardSafeSelectionControllerImpl
    implements BulletinBoardCardSafeSelectionController {
  final Map<BulletinBoardCardID, BulletinBoardCardSelectionLock> _selectionMap =
      {};

  @override
  BulletinBoardCardSelectionSet getSelectedCardsIDs() {
    return _selectionMap.keys.toSet();
  }

  @override
  void safeSetCardSelectionState(BulletinBoardCardID cardID, bool bSelected) {
    _changeStateIfPossible(cardID, bSelected, false);
  }

  @override
  void safeSetCardSelectionStateAndLock(
      BulletinBoardCardID cardID, bool bSelected) {
    _changeStateIfPossible(cardID, bSelected, true);
  }

  @override
  void safeSetCardSelectionStateOrSinkLock(
      BulletinBoardCardID cardID, bool bSelected) {
    if (_canChangeState(cardID, bSelected)) {
      _changeState(cardID, bSelected, false);
    } else {
      _sinkLockIfSelected(cardID);
    }
  }

  void _changeStateIfPossible(
      BulletinBoardCardID cardID, bool bSelected, final bool lockState) {
    if (_canChangeState(cardID, bSelected)) {
      _changeState(cardID, bSelected, lockState);
    }
  }

  void _changeState(
      BulletinBoardCardID cardID, bool bSelected, final bool lockState) {
    _selectionMap[cardID] = BulletinBoardCardSelectionLock(lockState);
  }

  void _sinkLockIfSelected(BulletinBoardCardID cardID) {
    if (_selectionMap.containsKey(cardID)) {
      _selectionMap[cardID] = const BulletinBoardCardSelectionLock(false);
    }
  }

  bool _canChangeState(BulletinBoardCardID cardID, bool bSelected) {
    // We need to check if the cardID is already selected,
    // and if we can set its new state. If the selection is locked we cannot
    // set the new state.
    final bool bIsAlreadySelected = _selectionMap.containsKey(cardID);
    final bool bIsStateLocked =
        bIsAlreadySelected && _selectionMap[cardID]!.isSelectionLocked();

    // To check if the state is new, we need to perform an XOR operation.
    // If the two states are equal, we don't have to update the state.
    final bool bIsNewState = bIsAlreadySelected ^ bSelected;
    return bIsNewState && !bIsStateLocked;
  }
}
