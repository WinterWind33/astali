// Copyright (C) 2023 Andrea Ballestrazzi

// Scenes

import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_card_fsm.dart';
import 'package:astali/cards-management/bulletin-board-cards/presentation/bulletin_board_card.dart';
import 'package:astali/cards-management/bulletin-board-cards/serialization/bulletin_board_card_data.dart';

import 'cards-management/bulletin-board-cards/bulletin_board_card_id.dart';
import 'cards-management/bulletin-board-cards/bulletin_board_card_selection_controller.dart';
import 'scenes/bulletin_board_scene.dart';
import 'package:astali/cards-management/bulletin-board-cards/bulletin_board_cards_manager.dart';

// Settings
import 'settings/astali_about_dialog.dart';

// Core and engine
import 'package:flutter/material.dart';
import 'dart:io';
import 'dart:convert';

typedef OnAboutItemClicked = VoidCallback;
typedef OnSaveBoardClicked = VoidCallback;

/// Represents a set of callbacks used inside the presentation
/// of the astali app home.
class ScenesCommonCallbacks {
  const ScenesCommonCallbacks(
      {required this.onAboutButtonClicked, required this.onSaveBoardClicked});

  // When the 'About' button is clicked inside the settings menu.
  final OnAboutItemClicked onAboutButtonClicked;
  final OnSaveBoardClicked onSaveBoardClicked;
}

class AstaliAppHomePresentation extends StatelessWidget {
  const AstaliAppHomePresentation(
      {required this.commonCallbacks,
      required this.bulletinBoardScene,
      super.key});

  final BulletinBoardScene bulletinBoardScene;
  final ScenesCommonCallbacks commonCallbacks;

  /// Creates the body of the main user interface.
  AppBar _createSceneTopBar() {
    return AppBar(
      title: const Text("Bulletin Board"),
      backgroundColor: Colors.blue,
      actions: <Widget>[
        PopupMenuButton<String>(
          icon: const Icon(Icons.settings),
          tooltip: "Settings",
          onSelected: (value) {
            switch (value) {
              case "About":
                commonCallbacks.onAboutButtonClicked();
                break;
              case "SaveBoard":
                commonCallbacks.onSaveBoardClicked();
                break;
              default:
            }
          },
          itemBuilder: (context) {
            return [
              const PopupMenuItem<String>(
                  value: "SaveBoard", child: Text("Save Board")),
              const PopupMenuItem<String>(value: "About", child: Text("About")),
            ];
          },
        )
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: _createSceneTopBar(),
      body: bulletinBoardScene,
    );
  }
}

/// Represents the home UI widget.
///
/// It contains all of the child widget that the user can tap or interact with.
/// It builds up the main user interface.
class AstaliAppHome extends StatefulWidget {
  const AstaliAppHome({super.key});

  @override
  State<AstaliAppHome> createState() => _AstaliAppHomeState();
}

/// Represents the main state of the AstaliAppHome widget.
///
/// Builds up the main user interface.
class _AstaliAppHomeState extends State<AstaliAppHome> {
  final BulletinBoardCardIDGenerator _bulletinBoardCardsIDsGenerator =
      BulletinBoardCardIDSimpleGenerator();
  final BulletinBoardCardsManager _cardsManager =
      BulletinBoardCardsManagerImpl();
  final BulletinBoardCardSafeSelectionController _safeSelectionController =
      BulletinBoardCardSafeSelectionControllerImpl();

  @override
  void initState() {
    super.initState();
    _loadBulletinBoardJsonProject("defaultProject.json").then((value) {
      setState(() {});
    });
  }

  @override
  void dispose() {
    // We need to save the project.
    _serializeBulletinBoardJsonProject("defaultProject");
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AstaliAppHomePresentation(
      bulletinBoardScene: BulletinBoardScene(
        bulletinBoardCardsManager: _cardsManager,
        cardsIDGenerator: _bulletinBoardCardsIDsGenerator,
        safeSelectionController: _safeSelectionController,
      ),
      commonCallbacks: ScenesCommonCallbacks(
          onAboutButtonClicked: _onAboutItemClicked,
          onSaveBoardClicked: _onSaveBoardClicked),
    );
  }

  void _onAboutItemClicked() {
    showAstaliAboutDialog(context);
  }

  void _onSaveBoardClicked() {
    _serializeBulletinBoardJsonProject("defaultProject");
  }

  Future<void> _loadBulletinBoardJsonProject(
      final String projectFileName) async {
    try {
      final file = await _projectFile;

      final contents = await file.readAsString();

      Map<String, dynamic> projectData = json.decode(contents);
      List<dynamic> cardsData = projectData["cards"];

      for (var rawCardData in cardsData) {
        BulletinBoardCardData cardData =
            BulletinBoardCardData.fromJson(rawCardData);

        var cardID = _bulletinBoardCardsIDsGenerator.generateID();
        final BulletinBoardCardKey cardKey = BulletinBoardCardKey(cardID);
        _cardsManager.addCard(BulletinBoardCard(
            key: cardKey,
            cardPosition: cardData.cardPosition,
            initialTitle: cardData.cardTitle,
            initialDescription: cardData.cardDescription,
            cardFSM: BulletinBoardCardNonDeterministicFSM(
                _cardsManager, _safeSelectionController)));
      }
    } catch (e) {}
  }

  void _serializeBulletinBoardJsonProject(final String projectName) {
    var bulletinBoardCards = _cardsManager.getBulletinBoardCards();

    Map<String, dynamic> jsonData = {"title": projectName};
    List<Map<String, dynamic>> cardsListJson =
        List<Map<String, dynamic>>.empty(growable: true);
    for (var card in bulletinBoardCards.values) {
      BulletinBoardCardData cardData = BulletinBoardCardData(
          cardPosition: card.cardPosition,
          cardDescription: card.initialDescription,
          cardTitle: card.initialTitle);

      cardsListJson.add(cardData.toJson());
    }

    jsonData.putIfAbsent("cards", () => cardsListJson);

    serializeProject(jsonData);
  }

  Future<File> serializeProject(Map<String, dynamic> projectData) async {
    final projectFile = await _projectFile;

    return projectFile.writeAsString(json.encode(projectData));
  }

  Future<File> get _projectFile async {
    return File("defaultProject.json");
  }
}
