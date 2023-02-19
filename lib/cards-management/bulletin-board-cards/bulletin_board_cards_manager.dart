// Copyright (c) 2023 Andrea Ballestrazzi

import 'presentation/bulletin_board_card.dart';
import 'bulletin_board_card_id.dart';

typedef BulletinBoardCards = Map<BulletinBoardCardID, BulletinBoardCard>;

abstract class BulletinBoardCardsManager {
  BulletinBoardCards getBulletinBoardCards();

  void addCard(BulletinBoardCard newCard);

  void updateCard(BulletinBoardCard card);

  void deleteCard(BulletinBoardCardID cardID);
}

class BulletinBoardCardsManagerImpl implements BulletinBoardCardsManager {
  BulletinBoardCardsManagerImpl() : _bulletinBoardCards = {};

  @override
  void addCard(BulletinBoardCard newCard) {
    assert(!_containsCard(newCard.cardID));

    _bulletinBoardCards.putIfAbsent(newCard.cardID, () => newCard);
  }

  @override
  void deleteCard(BulletinBoardCardID cardID) {
    assert(_containsCard(cardID));

    _bulletinBoardCards.remove(cardID);
  }

  @override
  BulletinBoardCards getBulletinBoardCards() {
    return _bulletinBoardCards;
  }

  @override
  void updateCard(BulletinBoardCard card) {
    assert(_containsCard(card.cardID));

    _bulletinBoardCards.update(card.cardID, (value) => card);
  }

  bool _containsCard(final BulletinBoardCardID cardID) {
    return _bulletinBoardCards.containsKey(cardID);
  }

  final BulletinBoardCards _bulletinBoardCards;
}
